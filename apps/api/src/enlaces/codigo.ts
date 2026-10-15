// clinica-7 · EL CÓDIGO DE 6 CIFRAS DEL ENLACE.
//
// Decisión 21: para abrir el enlace del informe hay que teclear un código
// que se enseña **una sola vez** en pantalla a quien lo envía, para darlo
// por otro canal — en mano o por teléfono.
//
// ── Qué compra esto, dicho en lo que pasa ────────────────────────────
//
// La URL es la credencial (decisión de clinica-2, y sigue valiendo: un
// paciente de 78 años no crea una cuenta). Pero una URL viaja sola: acaba
// en el historial de un móvil prestado, en un correo reenviado a la hija,
// en la vista previa de una pantalla de bloqueo. **Con el código, tener la
// URL no basta.** El que reenvía el correo no reenvía el código, porque el
// código nunca estuvo en el correo.
//
// Es el patrón del segundo factor, con la diferencia que lo hace
// aceptable: no hay que instalar nada ni registrarse. Quien manda el
// informe se lo dice al paciente por teléfono mientras habla con él, que
// es el momento en que ya están hablando.
//
// ── 6 cifras, y por qué eso basta ────────────────────────────────────
//
// Un millón de combinaciones es poco para fuerza bruta... si se pudiera
// probar. **5 fallos ANULAN el enlace**, y el enlace entero es de un
// `purpose` con 7 días de vida y 3 aperturas. Un atacante que tenga la URL
// —que ya es tenerla— dispone de cinco intentos sobre un millón: una
// probabilidad de 1 entre 200.000, y después el enlace está muerto y hay
// que llamar a la clínica.
//
// Más cifras habría significado un código que no se dicta por teléfono sin
// equivocarse, y un código que se dicta mal es una llamada más a la
// clínica. Seis es lo que todo el mundo ya sabe teclear.
//
// ── La huella, nunca el código ───────────────────────────────────────
//
// Se guarda `SHA-256(codigo)` en `public_links.code_hash`, y el CHECK del
// motor solo admite 64 hex: el código en claro NO CABE en la columna.
//
// Y aquí SÍ hay una diferencia con el token: el código son 20 bits, así
// que un diccionario de las 10^6 huellas se precomputa en un segundo. Eso
// **no se arregla con una sal** — con sal por fila, el diccionario se
// precomputa igual para esa fila concreta. Lo que lo arregla es que la
// huella no sirva de nada sin la fila: para probar el código hay que tener
// la URL (el token), y el token son 256 bits. Quien ve la base ve la
// huella y no tiene el token; quien tiene el token no ve la base.
//
// Por eso el código se compara en TIEMPO CONSTANTE sobre la huella, y por
// eso no se le pone un KDF lento: lo que encarecería sería la apertura
// legítima, y el ataque que un KDF frena (diccionario sobre la base
// filtrada) no abre nada sin el token.

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** Seis cifras. Ni letras ni guiones: se dicta por teléfono. */
export const PATRON_CODIGO = /^[0-9]{6}$/;

/** Cuántos fallos anulan el enlace. Decisión 21. */
export const FALLOS_QUE_ANULAN = 5;

/**
 * Un código nuevo. **`randomInt` del CSPRNG**, no `Math.random()`: un
 * código predecible es una cerradura con la llave puesta.
 *
 * El rango es `[0, 1_000_000)` rellenado a seis cifras, así que `000042`
 * es un código válido. Recortar los que empiezan por cero habría quitado
 * el 10 % del espacio por estética.
 */
export function nuevoCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** SHA-256 en hex. Ver la cabecera sobre por qué sin sal y sin KDF. */
export function huellaDeCodigo(codigo: string): string {
  return createHash("sha256").update(codigo, "utf8").digest("hex");
}

/**
 * ¿Es este el código del enlace?
 *
 * En tiempo constante sobre las huellas. Aquí sí está en el camino
 * caliente —se compara en cada apertura— y aquí sí importa: con una
 * comparación que corta en el primer carácter distinto, el tiempo de
 * respuesta filtra cuántas cifras van bien, y entonces los cinco intentos
 * dejan de ser cinco intentos sobre un millón.
 *
 * `false` cuando el enlace no tiene código: un `purpose` que pide código y
 * una fila sin él no se abre. No se cae a «pasa sin código», que es
 * exactamente el fallo que convertiría un enlace protegido en uno abierto.
 */
export function codigoCuadra(
  codigo: string,
  huellaGuardada: string | null,
): boolean {
  if (huellaGuardada == null) return false;
  if (!PATRON_CODIGO.test(codigo)) return false;
  const a = Buffer.from(huellaDeCodigo(codigo), "utf8");
  const b = Buffer.from(huellaGuardada, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Cómo se enseña en pantalla: `042 318`. Dos grupos de tres, que es como
 *  se dictan los números de teléfono en España y como se leen sin
 *  perderse. El código que se compara es el de seis cifras seguidas. */
export function codigoLegible(codigo: string): string {
  return `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
}
