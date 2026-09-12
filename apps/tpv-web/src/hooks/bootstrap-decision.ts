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
export type BootstrapDecision = "purge" | "retry" | "caja-disabled";

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
  return "retry";
}
