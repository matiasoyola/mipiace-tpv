// clinica-3 · LA pregunta de la regla 8: ¿esta persona ve importes?
//
// Decisión de producto 8 (Matías, 06-10-2026):
//
//   · **Dueña, encargado y cajero-sanitario** ven importes y pueden
//     «Cobrar ahora».
//   · **Sanitario sin caja**: NO VE IMPORTES EN NINGUNA PARTE. Ni el
//     total del pie de la sesión, ni al cerrar. Su botón dice «Cerrar
//     sesión» y al cerrar ve «Enviada a recepción para cobrar» con la
//     lista sin precios.
//
// Y el prompt lo subraya (§4): **comprobado en la API, no sólo escondido
// en pantalla.** Las respuestas que llegan a un `CLINICIAN` no llevan
// precios ni totales.
//
// ── Por qué una función y no un `if` por ruta ────────────────────────
//
// La misma razón que `ensureCajaEnabled` dio para las 103 rutas de caja
// (clinica-1 §7): cuatro sitios donde acordarse son cuatro sitios donde
// olvidarse. Aquí son menos rutas, pero el olvido es peor de leer — un
// importe que se cuela en una respuesta no revienta nada: se pinta.
//
// ── Y por qué es la MISMA pregunta que «¿puede cobrar?» ──────────────
//
// Porque lo es. Quien no puede cobrar no tiene por qué ver lo que se
// cobra: el precio no es información clínica y en esta clínica el que no
// toca la caja no lo necesita para su trabajo. Reutilizar
// `esSanitarioSinCaja` —la función que ya decide quién no cobra, con sus
// DOS comprobaciones (el rol del JWT y el rol de la base, que cierra la
// ventana de transición)— tiene dos efectos que una función nueva no
// tendría:
//
//   · el día que cambie quién cobra, cambia también quién ve importes, en
//     un solo sitio;
//   · y la ventana de transición queda cubierta gratis. Una cajera que
//     pasa a sanitaria deja de ver importes en el mismo instante en que
//     deja de poder cobrar, no cuando caduque su sesión del TPV.
//
// ── La dirección del fallo ───────────────────────────────────────────
//
// `esSanitarioSinCaja` **falla hacia encendido** (una lectura que revienta
// no puede ser el motivo de que no se cobre), así que esta función falla
// hacia «sí ve importes». Es la dirección correcta aquí también, y la
// razón es cuál de los dos daños es real:
//
//   · fallar hacia «no ve» dejaría a la DUEÑA sin poder cobrar la sesión
//     que acaba de cerrar, con la paciente delante;
//   · fallar hacia «sí ve» le enseña un precio a una sanitaria de su
//     propia clínica durante la ventana de una lectura que falló.
//
// Lo que NO depende de esto es ninguna frontera de aislamiento: el acceso
// a la historia lo deciden `acceso.ts` y `registro.ts`, y ninguno de los
// dos llama aquí. Y la comprobación 1 de `esSanitarioSinCaja` (el rol del
// JWT, sin I/O) no puede fallar, así que un `CLINICIAN` de verdad —que
// lleva su rol firmado en el token desde el login— nunca cae en esa
// ventana.

import type { FastifyRequest } from "fastify";

import { esSanitarioSinCaja } from "../lib/caja-gate.js";

/**
 * `true` si a esta petición se le pueden mandar precios, IVA y totales.
 *
 * Quien decide es la misma función que decide quién cobra. Ver la
 * cabecera para el por qué y para la dirección del fallo.
 */
export async function puedeVerImportes(
  request: FastifyRequest,
): Promise<boolean> {
  return !(await esSanitarioSinCaja(request));
}
