// residencia-6 (punto 2 del bloque) · **LO QUE NO SE DESCIFRA DEJA
// RASTRO.**
//
// `configurarAvisoDeIlegible` existe desde clinica-7 y **no lo llamaba
// nadie**. Lo anotaron clinica-7 §18, residencia-1b §12.1, residencia-3
// §15.4 y residencia-5 §19.11, cada vez con más columnas detrás: hoy son
// **veinticuatro**. Mientras nadie lo cableara, un valor cifrado que no se
// descifra salía como hueco en pantalla —«(este dato no se puede leer)»— y
// **no quedaba en ningún sitio**. Es el peor fallo posible de esta
// maquinaria: silencioso, y sólo visible para quien tuviera delante justo
// esa pantalla.
//
// Esto es ese cable. Tres piezas y ninguna más:
//
//   1. **qué se escribe** — seis campos, y ni uno más;
//   2. **qué NO se escribe** — el valor, el ciphertext, el mensaje del
//      error y la clave;
//   3. **cuántas veces** — una por sitio y por intervalo, no una por
//      lectura.
//
// ── 1 · LOS SEIS CAMPOS ─────────────────────────────────────────────
//
//   · `tenant`  — de qué centro o clínica es;
//   · `tabla`, `columna`, `fila` — qué valor exactamente;
//   · `sitio`   — desde dónde se intentaba leer (`GET /clinica/...`), o
//     `fuera-de-peticion` si fue un worker o un script;
//   · `motivo`  — de un vocabulario CERRADO de cuatro.
//
// Con esos seis, quien mira el log puede ir a la fila. Sin el `sitio`
// sabría qué fila y no si había alguien delante; sin el `motivo` tendría
// que abrir la base para saber si el problema es la clave del centro o esa
// fila concreta.
//
// ── 2 · POR QUÉ EL MOTIVO ES UN ENUM Y NO `err.message` ─────────────
//
// **Porque `err.message` filtra el dato.** No en teoría: `leerJson`
// descifra y después hace `JSON.parse`, y cuando el claro no es JSON el
// `SyntaxError` de V8 **trae el texto descifrado dentro del mensaje**:
//
//     Unexpected token 'l', "le huele raro el pie" is not valid JSON
//
// Registrar `err.message` habría escrito en el log la nota de «algo no va
// bien» de una residente, con todas las letras, en el único caso en que
// el cifrado funcionó. Es exactamente lo que este punto del bloque viene
// a impedir, así que el mensaje **no se toca**: se clasifica el TIPO del
// error y se escribe una de cuatro palabras.
//
// (De ahí también `SinClaveDeLaClinica` en `cripto.ts`: distinguir «este
// centro no tiene clave» de «este valor no abre» por subclase y no por el
// texto del mensaje.)
//
// Y tampoco va el **ciphertext**: con el AAD y el ciphertext en un log,
// quien tenga el log y la DEK tiene el dato — y los logs no se guardan
// como se guarda una base cifrada.
//
// ── 3 · UNA LÍNEA POR INTERVALO, NO UNA POR LECTURA ─────────────────
//
// Una historia con una entrada ilegible se pagina veinte veces en una
// mañana; la exportación del art. 20 la lee otra vez; el informe, otra. Y
// la pasada del relevo recorre el turno entero cada vez que corre. Sin
// freno, una sola fila mala llena el log y **tapa la siguiente**, que es
// la forma de que un rastro sirva para nada.
//
// El freno es una ventana por `tenant|tabla|columna|fila`: la primera
// lectura escribe, las de los quince minutos siguientes no. Memoria del
// proceso y no Redis a propósito: esto tiene que funcionar también cuando
// Redis no está (la CI no lo tiene, y la API arranca igual), y el peor
// caso de perderlo es escribir una línea de más tras un despliegue.
//
// El mapa está **acotado**: al llegar al tope se tira la mitad más vieja.
// Un diccionario que crece con cada fila ilegible distinta es una fuga de
// memoria en el proceso que sirve la historia clínica, y el precio de
// pasarse es una línea repetida.

import {
  NoSeDescifra,
  SinClaveDeLaClinica,
  type SitioDelValor,
} from "./cripto.js";
import { configurarAvisoDeIlegible } from "./cripto-campos.js";
import { sitioDeLectura } from "../lib/sitio-de-lectura.js";

/**
 * Por qué no se pudo leer. **Vocabulario cerrado**: ver la cabecera para
 * por qué no es el mensaje del error.
 *
 *   · `SIN_CLAVE`      — el centro no tiene clave clínica (o la KEK no la
 *     desenvuelve). No es de esta fila: le pasa a todas.
 *   · `NO_SE_DESCIFRA` — hay clave y este valor no abre con ella: la fila
 *     se movió, el AAD no es el suyo, o el ciphertext está tocado.
 *   · `NO_ES_JSON`     — descifró bien y lo de dentro no es el JSON que
 *     la columna promete. El cifrado funcionó; lo que está mal es el
 *     contenido.
 *   · `OTRO`           — cualquier otra cosa. Que exista es lo que impide
 *     que un error inesperado se cuele como uno de los tres de arriba.
 */
export type MotivoDeIlegible =
  | "SIN_CLAVE"
  | "NO_SE_DESCIFRA"
  | "NO_ES_JSON"
  | "OTRO";

/** La clasificación, por TIPO del error. Nunca por su mensaje. */
export function motivoDe(err: unknown): MotivoDeIlegible {
  if (err instanceof SinClaveDeLaClinica) return "SIN_CLAVE";
  if (err instanceof NoSeDescifra) return "NO_SE_DESCIFRA";
  // `JSON.parse` de un claro que no es JSON. Es el único caso en que el
  // descifrado FUE BIEN, y es el que no puede acercarse al mensaje.
  if (err instanceof SyntaxError) return "NO_ES_JSON";
  return "OTRO";
}

/** Lo que se escribe. Seis campos, y ni uno más. */
export interface LineaDeIlegible {
  tenant: string;
  tabla: string;
  columna: string;
  fila: string;
  sitio: string;
  motivo: MotivoDeIlegible;
}

/** Lo mínimo del logger de Fastify que esto usa. Un trozo y no
 *  `FastifyBaseLogger` entero: así el test le pasa el suyo sin montar un
 *  pino. */
export interface LogDeIlegible {
  error(obj: object, msg: string): void;
}

/** Quince minutos. Una historia se pagina veinte veces en una mañana; un
 *  turno se repasa cada vez que corre la pasada. */
export const INTERVALO_POR_DEFECTO_MS = 15 * 60_000;

/** Cuántos sitios distintos se recuerdan. Al pasarse se tira la mitad más
 *  vieja: una línea repetida es mejor que un mapa que crece sin fin en el
 *  proceso que sirve la historia. */
export const TOPE_DE_SITIOS = 5_000;

const ultimoAviso = new Map<string, number>();

function claveDe(sitio: SitioDelValor): string {
  return `${sitio.tenantId}|${sitio.tabla}|${sitio.columna}|${sitio.filaId}`;
}

/**
 * ¿Toca escribir esta línea?
 *
 * Expuesta para el test: lo que hay que poder afirmar es que cien
 * lecturas del mismo valor dejan UNA línea, y que el valor de al lado
 * deja la suya.
 */
export function tocaAvisar(
  sitio: SitioDelValor,
  ahora: number,
  intervaloMs: number,
): boolean {
  const clave = claveDe(sitio);
  const previo = ultimoAviso.get(clave);
  if (previo != null && ahora - previo < intervaloMs) return false;
  if (ultimoAviso.size >= TOPE_DE_SITIOS && previo == null) {
    // Los `Map` de JS iteran en orden de inserción, así que los primeros
    // son los más viejos. Se tira la mitad y no uno: tirar de uno en uno
    // deja el mapa pegado al tope y pagando el recorte en cada aviso.
    let porTirar = Math.floor(TOPE_DE_SITIOS / 2);
    for (const vieja of ultimoAviso.keys()) {
      if (porTirar-- <= 0) break;
      ultimoAviso.delete(vieja);
    }
  }
  ultimoAviso.set(clave, ahora);
  return true;
}

/**
 * **Cablea el aviso.** Lo llama `server.ts` al arrancar.
 *
 * Asignar una función: no abre conexiones, no lee la base y **no puede
 * lanzar**. Es lo que exige el arranque (el `smoke` arranca sin migrar) y
 * es la razón de que esto sea una línea en `main()` y no un plugin.
 *
 * `nivel error` y no `warn`: un valor cifrado que no se descifra es un
 * dato clínico que hoy no se puede leer. La petición sigue —el hueco
 * marcado es deliberado, clinica-7— pero lo que queda apuntado no es un
 * aviso de estilo: es algo que alguien tiene que mirar.
 */
export function cablearAvisoDeIlegible(
  log: LogDeIlegible,
  opciones: { intervaloMs?: number; ahora?: () => number } = {},
): void {
  const intervaloMs = opciones.intervaloMs ?? INTERVALO_POR_DEFECTO_MS;
  const ahora = opciones.ahora ?? (() => Date.now());
  configurarAvisoDeIlegible((sitio, err) => {
    if (!tocaAvisar(sitio, ahora(), intervaloMs)) return;
    const linea: LineaDeIlegible = {
      tenant: sitio.tenantId,
      tabla: sitio.tabla,
      columna: sitio.columna,
      fila: sitio.filaId,
      sitio: sitioDeLectura(),
      motivo: motivoDe(err),
    };
    // El segundo argumento es FIJO. Un mensaje armado con datos de dentro
    // sería el mismo agujero que `err.message`, por el otro lado.
    log.error(linea, "clinica · valor cifrado que no se puede leer");
  });
}

/** Sólo tests: olvida la ventana de dedupe. */
export function __reiniciarAvisoDeIlegible(): void {
  ultimoAviso.clear();
}
