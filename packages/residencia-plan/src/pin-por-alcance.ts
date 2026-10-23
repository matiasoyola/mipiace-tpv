// residencia-6 (D-68) · **CUÁNTAS CIFRAS TIENE QUE TENER UN PIN.**
//
// Cuatro para quien tiene alcance por zona —la auxiliar, que entra
// cuarenta veces por turno— y **seis** para quien tiene algún rol de
// alcance total: DUE, médico, calidad, dirección. Quien lleva de los dos
// tipos, seis.
//
// ── POR QUÉ, EN UNA FRASE ───────────────────────────────────────────
//
// Una tablet robada lleva el roster cacheado dentro: la huella HMAC de
// cada PIN y la subclave con la que se recalcula (residencia-3 §15.2). Con
// eso, probar las diez mil combinaciones de cuatro cifras es instantáneo y
// **se aprende el PIN de toda la plantilla**. Con seis cifras, sacar el de
// quien lo ve todo cuesta cien veces más. Quien entra cuarenta veces por
// turno sigue con cuatro, porque su PIN sólo abre lo de su zona y porque
// el presupuesto de D-05 son dos segundos por registro.
//
// ── Y VIVE EN EL PAQUETE PURO ───────────────────────────────────────
//
// Por la razón de siempre en este paquete: **la puerta resuelve el PIN
// sin red**. El arranque le trae el roster con los roles de cada uno, y la
// tablet tiene que llegar a la misma conclusión que el servidor sobre si
// ese PIN vale o está por renovar. Dos copias de esta regla serían un PIN
// que entra sin red y no entra con ella.
//
// Es el mismo razonamiento que `gravedadDe` (residencia-4), `queToca`
// (residencia-2) y `alcanceDe` (residencia-5).
//
// ── LO QUE AQUÍ NO HAY, Y ES LA MITAD DE LA DECISIÓN ────────────────
//
// **Nada derivado de los cuatro primeros dígitos de un PIN de seis.** Ni
// una huella del prefijo, ni un índice por él, ni un «busca por los
// cuatro primeros y después verifica». Eso reduciría el ataque a
// 10 000 + 100 combinaciones y anularía la decisión entera: costaría lo
// mismo que hoy más un rato. Lo único que se guarda del largo es el
// NÚMERO de cifras (`care_pins.pin_length`), y eso no acerca a nadie al
// PIN: quien tiene la base ya ve los roles de cada persona en claro, y la
// regla rol → largo está escrita aquí, a la vista.

/** Cuatro cifras. Alcance por zona. */
export const LARGO_POR_ZONA = 4;

/** Seis. Alcance total (D-68). */
export const LARGO_DE_ALCANCE_TOTAL = 6;

/** Y el techo de lo que la API acepta, que viene de residencia-3 y no
 *  cambia: un centro puede alargarlo sin migración. El teclado de la
 *  puerta ofrece cuatro y seis; de cinco a ocho se pueden poner desde el
 *  admin y entonces sólo se teclean donde haya teclado completo. */
export const LARGO_MAXIMO = 8;

/** Lo que de un rol de cuidado hace falta saber para esto. Un campo. */
export interface RolParaElPin {
  /** `CareRole.fullScope`: ve todo el centro sin zona (D-51). */
  alcanceTotal: boolean;
}

/**
 * Cuántas cifras le tocan a esta persona, por sus roles VIGENTES.
 *
 * Sin roles, cuatro: es el caso de quien todavía no tiene ninguno, y la
 * ruta del PIN ya lo para antes por otro motivo («dale primero un rol de
 * cuidado que registre»). Devolver seis aquí habría hecho que la
 * dirección tuviera que adivinar el largo de alguien a quien el sistema
 * no le va a dejar poner PIN.
 */
export function largoDePinRequerido(roles: readonly RolParaElPin[]): number {
  return roles.some((r) => r.alcanceTotal)
    ? LARGO_DE_ALCANCE_TOTAL
    : LARGO_POR_ZONA;
}

/**
 * ¿El PIN que tiene puesto se quedó corto para lo que ahora ve?
 *
 * Es el caso que D-68 nombra: a una auxiliar con PIN de cuatro se le
 * asigna el rol de DUE. Nadie le cambia el PIN —la dirección ha tocado
 * los roles, no el PIN— y desde ese momento ese PIN de cuatro abre todo
 * el centro. Lo que pasa entonces es que **no abre nada** hasta que se lo
 * renueven, y las tres pantallas lo dicen con la misma frase.
 *
 * El `largoDelPin` es el que se guardó al ponerlo. No se recalcula de
 * nada: el PIN no se puede leer, y ahí está el punto.
 */
export function pinPorRenovar(input: {
  largoDelPin: number;
  roles: readonly RolParaElPin[];
}): boolean {
  return input.largoDelPin < largoDePinRequerido(input.roles);
}

/** La frase, UNA y la misma en la puerta, la sala y el móvil de guardia.
 *  Quien la lee está de pie en un pasillo: dice qué pasa y a dónde ir, y
 *  no «PIN incorrecto», que la dejaría tecleándolo otra vez. */
export const FRASE_PIN_POR_RENOVAR =
  "Tu PIN tiene que ser de 6 cifras: pídelo en dirección.";

/**
 * Qué le pasa al PIN que la dirección acaba de teclear, o `null` si está
 * bien. La frase es para la pantalla del admin, que es donde se arregla.
 *
 * Se valida **al darlo o cambiarlo** y no al usarlo, que es lo que pide
 * D-68: un PIN que se rechaza en Personal lo arregla quien lo está
 * poniendo, con el teclado delante.
 */
export function problemaDelPinNuevo(
  pin: string,
  roles: readonly RolParaElPin[],
): string | null {
  if (!/^[0-9]+$/.test(pin)) return "El PIN son sólo cifras.";
  const requerido = largoDePinRequerido(roles);
  if (pin.length < requerido) {
    return requerido === LARGO_DE_ALCANCE_TOTAL
      ? "Esta persona tiene un rol que ve todo el centro, así que su PIN " +
          "tiene que ser de 6 cifras. Con 4, una tablet robada permite " +
          "probar las diez mil combinaciones y sacarlo."
      : `El PIN tiene que ser de al menos ${requerido} cifras.`;
  }
  if (pin.length > LARGO_MAXIMO) {
    return `El PIN no puede pasar de ${LARGO_MAXIMO} cifras.`;
  }
  return null;
}
