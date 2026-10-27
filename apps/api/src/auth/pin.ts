// pin-1 · LAS REGLAS DEL PIN, EN UN SOLO SITIO.
//
// El formato, qué PIN es demasiado fácil de adivinar, y el PIN aleatorio
// del último recurso de soporte. Sin `loadEnv`, sin Prisma y sin Fastify:
// es puro, así que se puede probar de verdad y lo pueden importar las
// cinco rutas que tocan un PIN sin arrastrar nada.
//
// ── POR QUÉ SE RECHAZAN LOS TRIVIALES, Y DÓNDE ──────────────────────
//
// Desde este bloque el PIN **lo elige la persona**, y un PIN que elige
// una persona con prisa es `1234`. Eso convierte los cinco intentos del
// bloqueo por intentos en una garantía falsa: con 1234, 0000 y 1111 se
// entra en tres.
//
// El filtro va en las CUATRO rutas donde un humano teclea un PIN que se
// va a guardar —cambiar el mío, elegirlo sin el actual, el alta de
// personal y el reset de personal— y no sólo en la primera. Que falte en
// una es la que se usa: el PIN provisional del alta funciona hasta que
// la cajera lo cambie, y entre el alta y el primer turno pasan días.
//
// Lo que NO filtra: el LOGIN. Un PIN trivial ya guardado sigue
// entrando — nadie se queda fuera al desplegar, y el día que lo cambie
// se le pedirá otro. Y tampoco filtra el PIN de puerta de la residencia
// (`care_pins`), que es otra cosa y tiene sus propias reglas de largo.

/** El formato de siempre: 4 a 8 cifras. Este bloque no lo cambia. */
export const PIN_FORMAT = "^[0-9]{4,8}$";

export function pinConFormato(pin: string): boolean {
  return new RegExp(PIN_FORMAT).test(pin);
}

/**
 * Por qué ese PIN es fácil de adivinar, o `null` si pasa.
 *
 * Devuelve el MOTIVO y no un booleano porque el mensaje tiene que decir
 * por qué (requisito del bloque): «no vale» a secas deja a la propietaria
 * probando 1111 después de 1234.
 */
export function motivoPinTrivial(pin: string): string | null {
  if (!pinConFormato(pin)) return null; // el formato lo rechaza el schema

  // 1 · todas las cifras iguales: 0000, 1111, 99999999.
  if (/^(\d)\1*$/.test(pin)) return "son todas la misma cifra";

  // 2 y 3 · cifras seguidas, para arriba o para abajo: 1234, 0123,
  // 456789, 4321, 9876, 3210. Sin dar la vuelta (8901 no es "seguido"
  // para quien lo teclea, y no está entre los PIN que la gente elige).
  const digitos = [...pin].map(Number);
  const paso = (d: number) =>
    digitos.every((n, i) => i === 0 || n === digitos[i - 1]! + d);
  if (paso(1)) return "son cifras seguidas";
  if (paso(-1)) return "son cifras seguidas hacia atrás";

  // 4 · un trozo repetido: 1212, 1010, 123123, 12121212. Cubre los
  // "patrones" que la gente elige creyendo que no son un patrón.
  for (let largo = 1; largo <= pin.length / 2; largo++) {
    if (pin.length % largo !== 0) continue;
    const trozo = pin.slice(0, largo);
    if (pin === trozo.repeat(pin.length / largo)) {
      return "es un trozo que se repite";
    }
  }

  // 5 · la columna del medio del teclado, de arriba abajo y de abajo
  // arriba. No se deduce de ninguna regla de las de arriba —2580 no es
  // ni seguido ni repetido— y está entre los cinco PIN más usados del
  // mundo precisamente por eso: es el gesto más cómodo del teclado.
  if (pin === "2580" || pin === "0852") return "es una columna del teclado";

  return null;
}

/**
 * El mensaje que ve la persona. Dice QUÉ pasa, POR QUÉ y qué hacer.
 *
 * Una sola función para que el panel y el TPV digan exactamente lo mismo:
 * son la misma negativa.
 */
export function mensajePinTrivial(motivo: string): string {
  return `Ese PIN es demasiado fácil de adivinar: ${motivo}. Elige otro — con cinco intentos antes del bloqueo, un PIN así se acierta a la primera.`;
}

/** El cuerpo del 400 cuando el PIN elegido es trivial. */
export function errorPinTrivial(motivo: string): {
  error: "PIN_DEMASIADO_FACIL";
  code: "PIN_DEMASIADO_FACIL";
  message: string;
} {
  return {
    error: "PIN_DEMASIADO_FACIL",
    code: "PIN_DEMASIADO_FACIL",
    message: mensajePinTrivial(motivo),
  };
}

/**
 * El PIN aleatorio del ÚLTIMO RECURSO (decisión del bloque: el sistema no
 * genera PINs para nadie salvo aquí). Lo usa «Regenerar PIN» de
 * super-admin, y lo que deja puesto es PROVISIONAL.
 *
 * Pide `randomInt` por parámetro para que el banco pueda forzar el caso
 * «salió 1234» sin esperar a que la suerte lo reproduzca: con un
 * generador que devuelve siempre 1234, esta función tiene que seguir
 * devolviendo algo que NO sea trivial. El caller real le pasa
 * `crypto.randomInt`, que es lo que evita el sesgo del módulo en 10.000.
 */
export function generarPinDeSoporte(
  randomInt: (min: number, max: number) => number,
): string {
  // Cuatro cifras, como siempre. El sorteo se repite mientras salga un
  // trivial: 1234 y 0000 están dentro de las 10.000 combinaciones, y un
  // PIN de soporte que el propio sistema rechazaría al cambiarlo sería
  // absurdo. Hay menos de 100 triviales, así que el rechazo cae a la
  // primera o a la segunda.
  const comoPin = (n: number) => n.toString().padStart(4, "0");
  let n = 0;
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    n = randomInt(0, 10_000);
    if (motivoPinTrivial(comoPin(n)) === null) return comoPin(n);
  }
  // La salida garantizada, y no «devuelvo el último que salió». 50
  // rechazos seguidos sólo pasan con un generador roto o amañado (el del
  // banco), y en ese caso lo que NO puede pasar es devolver un PIN
  // trivial: la función promete que no lo hace. Avanzar desde donde se
  // quedó siempre termina — hay 9.900 PIN buenos de 10.000.
  for (let i = 1; i <= 10_000; i++) {
    const candidato = comoPin((n + i) % 10_000);
    if (motivoPinTrivial(candidato) === null) return candidato;
  }
  // Inalcanzable: la vuelta de arriba recorre las 10.000 combinaciones y
  // la gran mayoría pasan el filtro.
  throw new Error("no hay ningún PIN de 4 cifras que no sea trivial");
}
