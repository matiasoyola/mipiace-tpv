// v1.4-Bugs-Operativos Lote 3 · función pura usada por `useDeviceBootstrap`
// para decidir si un error del backend debe desemparejar el dispositivo
// (purga localStorage) o reintentar conservando el token.
//
// Vivía inline en el hook pero la lógica era el sitio donde quedó el
// bug "se desempareja al cerrar el navegador". Aislándola en una
// función pura podemos cubrirla con un test sin necesidad de jsdom ni
// de la suite React (diferida por carryovers de B7).

import { ApiError } from "../api.js";

export type BootstrapDecision = "purge" | "retry";

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
  return "retry";
}
