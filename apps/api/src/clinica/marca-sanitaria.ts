// clinica-8 · LA MARCA SANITARIA DE QUIEN ESTÁ MIRANDO, AL DÍA.
//
// El TPV lee `isClinician` en el login del cajero (`shift/cashier-auth.ts`)
// y lo guarda en la sesión del aparato, que vive el turno entero — doce
// horas por defecto. Así que marcar a alguien como sanitario desde el panel
// **no llegaba al TPV hasta que cerraba sesión y volvía a entrar**: la
// auditoría del 18-10 marcó a la propietaria, volvió a la cita y la cita
// seguía sin enseñar nada clínico. Lo que se ve es «esto no funciona»,
// porque desde fuera no hay forma de saber que hace falta re-entrar.
//
// La marca no es una PUERTA —cada ruta clínica la vuelve a comprobar contra
// la base, y `resolverAccesoClinico` la lee de la fila, no del token—, así
// que esto no abre nada: decide qué BOTONES se pintan. Por eso puede viajar
// con el refresco de la agenda en vez de obligar a reemitir el token.
//
// ── Lo que cuesta, y a quién ─────────────────────────────────────────
//
// `null` en cuanto el comercio no tiene la clínica encendida, y ahí no
// cuesta ninguna consulta extra: `clinicaIsEnabled` es la misma lectura del
// tenant que ya hacen las otras dos piezas clínicas de `GET /agenda`. Los
// catorce tenants sin clínica reciben `null` y la pantalla no cambia nada.
// En una clínica es UNA lectura por id del usuario que está mirando.

import { getPrisma } from "../context.js";
import { clinicaIsEnabled } from "./gate.js";

/**
 * ¿Lleva ESTE usuario la marca sanitaria ahora mismo?
 *
 * - `null` → no hay nada que decir (comercio sin clínica, sin usuario, o la
 *   lectura falló). Quien llama deja la pantalla como estaba: una marca que
 *   no se ha podido leer no puede quitarle los botones a una sanitaria.
 * - `true` / `false` → lo que dice la fila hoy.
 */
export async function marcaSanitariaDe(
  tenantId: string,
  userId: string | null | undefined,
): Promise<boolean | null> {
  if (!userId) return null;
  try {
    if (!(await clinicaIsEnabled(tenantId))) return null;
    const user = await getPrisma().user.findFirst({
      where: { id: userId, tenantId },
      select: { isClinician: true },
    });
    return user ? user.isClinician === true : null;
  } catch {
    // Falla hacia «no sé», nunca hacia «no es sanitaria». Ver la cabecera.
    return null;
  }
}
