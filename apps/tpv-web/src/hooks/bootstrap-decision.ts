// v1.4-Bugs-Operativos Lote 3 · función pura usada por `useDeviceBootstrap`
// para decidir si un error del backend debe desemparejar el dispositivo
// (purga localStorage) o reintentar conservando el token.
//
// Vivía inline en el hook pero la lógica era el sitio donde quedó el
// bug "se desempareja al cerrar el navegador". Aislándola en una
// función pura podemos cubrirla con un test sin necesidad de jsdom ni
// de la suite React (diferida por carryovers de B7).

import { ApiError } from "../api.js";

// H1 · tercera salida, `caja-disabled`. Antes del bloque, un 403 caía en
// `retry`: el hook se quedaba en `loading` y reintentaba cada 3 s para
// siempre. Es decir, spinner infinito — la "pantalla en blanco" que el
// TPV no puede permitirse. Ahora el terminal lo dice y para.
//
// No es `purge`: el dispositivo sigue emparejado y su token sigue siendo
// bueno. Si mañana le encienden la caja a la empresa, el mismo terminal
// arranca sin volver a emparejarlo.
// kds-1-cocina · cuarta salida, `kitchen`. Un dispositivo `KITCHEN`
// llamando a `/devices/me` recibe **403 KITCHEN_DEVICE_NOT_ALLOWED**: ese
// corte está en `devices/auth.ts`, la puerta de TODAS las rutas del TPV, y
// es lo que hace que una pantalla de cocina no pueda cobrar ni abrir turno.
//
// Así que el 403 no es un error: es la respuesta correcta y es la señal de
// que esta tablet arranca en «modo cocina». La MISMA APK, otra pantalla
// (decisión 1). No es `purge` —el aparato está perfectamente emparejado— ni
// `retry`, que lo dejaría en el spinner para siempre.
export type BootstrapDecision = "purge" | "retry" | "caja-disabled" | "kitchen";

// Sólo estos códigos disparan purga real del deviceToken. Cualquier
// otro 401 (sin código o con código desconocido) y los errores de red
// se tratan como transitorios.
const HARD_REVOKE_CODES = new Set(["DEVICE_REVOKED", "DEVICE_TOKEN_EXPIRED"]);

export function decideAfterBootstrapError(err: unknown): BootstrapDecision {
  if (
    err instanceof ApiError &&
    err.status === 401 &&
    typeof err.code === "string" &&
    HARD_REVOKE_CODES.has(err.code)
  ) {
    return "purge";
  }
  if (err instanceof ApiError && err.status === 403 && err.code === "CAJA_DISABLED") {
    return "caja-disabled";
  }
  if (
    err instanceof ApiError &&
    err.status === 403 &&
    err.code === "KITCHEN_DEVICE_NOT_ALLOWED"
  ) {
    return "kitchen";
  }
  return "retry";
}
