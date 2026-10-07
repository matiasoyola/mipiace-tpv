// clinica-2 · el enlace del test. **Desde `enlaces-publicos`, la cara de
// la valoración sobre la PUERTA COMÚN.**
//
// Lo que este fichero tenía —generar el token, hashearlo, decidir si sigue
// vivo, el rate-limit— vive ahora en `apps/api/src/enlaces/`, generalizado
// y sin una palabra de clínica:
//
//   · el token y su huella      → `enlaces/token.ts`
//   · la caducidad por canal,   → `enlaces/reglas.ts` (`REGLAS_VALORACION`)
//     el uso único, el perfil,
//     el estado admitido
//   · los dos límites           → `enlaces/limites.ts`
//   · el orden de las
//     comprobaciones y la 404   → `enlaces/puerta.ts`
//
// **No se reescribió: se generalizó.** Cada decisión de clinica-2 que
// seguía valiendo viajó con su comentario al sitio donde manda ahora, y
// las que eran de la valoración (30 días por email, 4 horas en tablet, un
// solo uso, pendiente de contestar) son las reglas de su `purpose`.
//
// Aquí se queda lo que es de la valoración y de nadie más: la URL que
// viaja en el email. Y dos envoltorios de un renglón sobre la puerta, que
// son la forma que clinica-2 publicó.

import {
  REGLAS_VALORACION,
  DIAS_DE_VIDA_DEL_ENLACE,
  HORAS_DE_VIDA_EN_TABLET,
} from "../enlaces/reglas.js";
import { huellaDeToken, nuevoToken } from "../enlaces/token.js";

export { DIAS_DE_VIDA_DEL_ENLACE, HORAS_DE_VIDA_EN_TABLET };

/** La URL que viaja en el email. La pinta la PWA del TPV: el test ES una
 *  pantalla, y es LA MISMA que la de la tablet de la sala. */
export function urlDelEnlace(baseTpvUrl: string, token: string): string {
  return `${baseTpvUrl.replace(/\/+$/, "")}/valoracion/${token}`;
}

/** La huella que se guarda. Alias de `enlaces/token.ts::huellaDeToken`,
 *  con el nombre que clinica-2 publicó. */
export const hashDeToken = huellaDeToken;

export interface TokenNuevo {
  /** El token en claro. */
  token: string;
  /** Lo que sí se guarda. */
  hash: string;
  expiraEn: Date;
}

/**
 * Un token y su huella con la caducidad del canal, SIN crear la fila.
 *
 * En producción ya no lo llama nadie: quien necesita un enlace llama a
 * `crearEnlace`, que genera el token Y escribe la fila de `public_links`
 * en un solo acto —y así no puede existir un token que no está en ninguna
 * fila, ni una fila con un token que nadie tiene.
 *
 * Se conserva porque es la forma que clinica-2 publicó y la usa quien
 * FABRICA filas a mano: la guardia de regresión del enlace, que necesita
 * un token y su huella para poner una valoración con enlace vivo o
 * caducado sin pasar por el envío.
 */
export function nuevoTokenDeEnlace(
  canal: "EMAIL" | "TABLET" = "EMAIL",
  ahora = new Date(),
): TokenNuevo {
  const token = nuevoToken();
  return {
    token,
    hash: huellaDeToken(token),
    expiraEn: new Date(ahora.getTime() + REGLAS_VALORACION.vidaMs(canal)),
  };
}
