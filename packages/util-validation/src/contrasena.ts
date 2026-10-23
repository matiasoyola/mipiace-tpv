// primer-acceso · LOS REQUISITOS DE UNA CONTRASEÑA, EN UN SOLO SITIO.
//
// La página de bienvenida marca los requisitos EN VIVO mientras Carmen
// escribe, y el servidor los exige al aceptar la invitación. Son la misma
// lista porque están en el mismo fichero: con una copia en cada lado, el
// día que alguien suba el mínimo a 14 la pantalla pondría el tic verde a
// los 12 y el botón devolvería un 400 que Carmen no sabe leer.
//
// Por qué estas tres y no las ocho de siempre: la contraseña se escribe
// UNA vez, con el correo abierto al lado, y quien la escribe es la
// directora de una residencia. Doce caracteres con una letra y un número
// es lo que el NIST recomienda (longitud antes que ornamento) y es lo que
// cabe decir en tres líneas que se leen sin pensar.
//
// Sin `node:crypto` y sin nada de Node: este fichero lo importa también el
// panel, que corre en un navegador. Vive en su propio export (`./contrasena`)
// por eso mismo — el `index.ts` del paquete arrastra `temporary-password.ts`,
// que sí usa `node:crypto`.

/** El mínimo. Lo comparte `/auth/change-password-initial`, que ya pedía 12. */
export const CONTRASENA_MIN = 12;

export interface RequisitoDeContrasena {
  /** La frase que se enseña, tal cual, con el tic al lado. */
  texto: string;
  cumple: boolean;
}

/**
 * Los requisitos con su estado para una contraseña concreta.
 *
 * Devuelve SIEMPRE la lista entera —no sólo los que fallan— porque la
 * pantalla los pinta todos desde el primer carácter y los va marcando. El
 * servidor mira `cumple`.
 */
export function requisitosDeContrasena(
  contrasena: string,
): RequisitoDeContrasena[] {
  return [
    {
      texto: `Al menos ${CONTRASENA_MIN} caracteres`,
      cumple: contrasena.length >= CONTRASENA_MIN,
    },
    { texto: "Alguna letra", cumple: /\p{L}/u.test(contrasena) },
    { texto: "Algún número", cumple: /\d/.test(contrasena) },
  ];
}

/** `true` cuando los tres requisitos se cumplen. */
export function contrasenaValida(contrasena: string): boolean {
  return requisitosDeContrasena(contrasena).every((r) => r.cumple);
}

/** Lo que el servidor contesta cuando no los cumple. Una frase, no tres. */
export const MENSAJE_CONTRASENA_CORTA =
  `La contraseña necesita al menos ${CONTRASENA_MIN} caracteres, ` +
  "una letra y un número.";
