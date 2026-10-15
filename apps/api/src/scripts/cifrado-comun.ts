// residencia-1b · LO QUE COMPARTEN LOS PASOS DEL CIFRADO.
//
// `cifrar-lo-existente.ts` nació con estas cuatro piezas dentro, y estaba
// bien mientras fuera un fichero. Cuando residencia-1b añadió las tres
// tablas de la residencia hicieron falta en dos sitios, y copiarlas habría
// sido dos `verificar` que pueden dejar de verificar lo mismo.
//
// No hay nada aquí que corra al importarlo: es lo que exige
// `scripts-no-corren-al-importarlos.test.ts`, y el e2e de residencia-1b
// importa los pasos de la residencia para probarlos.

import { descifrarValor } from "../clinica/cripto.js";

/** Cuántas filas por tanda. Pequeño a propósito: cada tanda es una
 *  transacción corta, así que el script no se pelea con la aplicación por
 *  los bloqueos mientras un centro está abierto. */
export const TANDA = 200;

export interface Cuenta {
  cifradas: number;
  yaEstaban: number;
  vaciadas: number;
}

export function cuenta(): Cuenta {
  return { cifradas: 0, yaEstaban: 0, vaciadas: 0 };
}

/** Lo cifrado no vuelve igual. Clase propia porque el script la trata
 *  distinto: PARA, y dice que lo de antes está bien. */
export class NoCuadra extends Error {}

/**
 * Descifra lo que se acaba de cifrar y lo compara. El corazón del
 * «verifica»: sin esto, el script podría estar escribiendo ciphertext que
 * nadie puede abrir y no se sabría hasta que alguien abriera una ficha.
 */
export function verificar(
  cifrado: string,
  original: string,
  dek: Buffer,
  sitio: Parameters<typeof descifrarValor>[2],
  que: string,
): void {
  const vuelta = descifrarValor(cifrado, dek, sitio);
  if (vuelta !== original) {
    throw new NoCuadra(
      `${que}: lo cifrado no vuelve igual. NO se sigue. (${sitio.tabla}.${sitio.columna} / ${sitio.filaId})`,
    );
  }
}
