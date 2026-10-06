// clinica-2 · LA puerta del primer tratamiento, contra la base.
//
// La decisión es pura y vive en `@mipiacetpv/clinica-valoracion`
// (`puedeRecibirPrimerTratamiento`); esto es lo que lee las valoraciones
// del paciente y se la da. Misma separación que `acceso.ts` /
// `resolverAccesoClinico` de clinica-1, y por la misma razón: la tabla de
// casos del test es una tabla de verdad y no una maqueta de Prisma.
//
// ── Para qué está aquí si este bloque no la usa ───────────────────────
//
// Porque `clinica-3` (la sesión) la va a usar como puerta, y el prompt
// pide escribirla, exportarla y testearla ahora. Escribirla cuando llegue
// la sesión significaría escribirla con prisa y en medio de otra pantalla,
// que es cómo una regla acaba repetida en dos sitios.
//
// **Este bloque no inventa la entrada de tratamiento.** Lo único que hace
// con esta función, además de testearla, es contestar con ella en la vista
// de la valoración: la pantalla del sanitario necesita saber si puede
// decir «ya puedes registrar el primer tratamiento» (el aviso verde del
// mockup) y es exactamente la misma pregunta.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  puedeRecibirPrimerTratamiento,
  type PuertaPrimerTratamiento,
} from "@mipiacetpv/clinica-valoracion";

import { valoracionesParaLaPuerta } from "./valoracion.js";

/**
 * ¿Puede este paciente recibir su primer tratamiento?
 *
 * **No comprueba el acceso clínico y no apunta nada en el registro**, y es
 * deliberado: es una pregunta sobre el estado del paciente, no una lectura
 * de su historia. Quien la llama tiene que estar ya dentro de
 * `conHistoria` (en este bloque lo está: se contesta desde la vista de la
 * valoración, que es una ruta registrada). Dicho de otro modo: esta
 * función no es una puerta de autorización, es la puerta CLÍNICA. Las dos
 * hacen falta y son distintas.
 *
 * Tampoco mira si el módulo está encendido: con la clínica apagada no hay
 * valoraciones, así que contesta `SIN_VALORACION` — que es verdad y es lo
 * seguro. La 404 del módulo la pone el gate de la ruta, antes.
 */
export async function resolverPrimerTratamiento(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<PuertaPrimerTratamiento> {
  const valoraciones = await valoracionesParaLaPuerta(prisma, input);
  return puedeRecibirPrimerTratamiento(valoraciones);
}

export { puedeRecibirPrimerTratamiento };
export type { PuertaPrimerTratamiento };
