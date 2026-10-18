// clinica-7 · CADA COLUMNA CIFRADA, CON SU SITIO ESCRITO UNA SOLA VEZ.
//
// Nueve columnas de la clínica (clinica-7), seis de la residencia
// (residencia-1b, D-63) y dos del registro de cuidados (residencia-3).
// Diecisiete.
//
// `cripto.ts` cifra con un AAD; aquí vive **qué AAD le toca a cada
// columna**. Y vive en un solo fichero por la razón de siempre en este
// módulo: el AAD es parte del ciphertext, así que dos sitios que armen el
// de `clinical_entries.body` con nombres distintos dejan filas que no se
// descifran — y no «mal», sino para siempre.
//
// Por eso no hay ni una llamada a `aadDe` fuera de aquí. Un test lo
// vigila.
//
// ── EL ID DE LA FILA HAY QUE SABERLO ANTES DE INSERTARLA ────────────
//
// El AAD ata el valor a `tenant|tabla|columna|id de fila`, y el id de una
// fila que todavía no existe no se puede leer. Así que **los INSERT
// clínicos generan su uuid en la aplicación** (`randomUUID()`) y lo pasan
// explícitamente, en vez de dejar que lo ponga el `@default(uuid())` de
// Prisma.
//
// Las dos alternativas eran peores:
//
//   · insertar y después hacer un UPDATE con el cifrado → los triggers de
//     inmutabilidad lo rechazan, y relajarlos para esto sería abrir la
//     fila a reescrituras justo donde no se puede;
//   · atar el AAD a algo que no sea el id (la fecha, el paciente) → y
//     entonces dos valores del mismo paciente serían intercambiables, que
//     es exactamente lo que la decisión 15 cierra.
//
// ── Qué pasa cuando un valor NO se descifra ─────────────────────────
//
// Se devuelve **un hueco marcado**, no una excepción, y es la misma
// decisión que clinica-4 tomó con el PDF cuya huella no cuadra: enseñarlo
// con el aviso en vez de esconderlo.
//
// El motivo es concreto. Si una entrada de ochenta no se descifra,
// reventar la petición deja al paciente sin su historia entera —y tiene
// derecho a ella— por un fallo en una línea. Con el hueco, la podóloga ve
// setenta y nueve visitas y una que dice «esta anotación no se puede
// leer», que es justo lo que alguien tiene que mirar. Esconderla sería
// borrar la única pista.
//
// Y el log de ese fallo lleva la tabla, la columna y el id. **Nunca el
// ciphertext ni la clave**, como los `catch` de `registro.ts`.

import { randomUUID } from "node:crypto";

import {
  NoSeDescifra,
  cifrarValor,
  descifrarValor,
  esCifrado,
  type SitioDelValor,
} from "./cripto.js";

/** El uuid de una fila clínica, generado en la aplicación porque su AAD lo
 *  necesita. Ver la cabecera. */
export function nuevoIdDeFila(): string {
  return randomUUID();
}

// ── Los sitios, uno por columna ──────────────────────────────────────
//
// Nombres de TABLA (no de modelo de Prisma) y nombres LÓGICOS de columna.
// El nombre lógico es el de la columna en claro (`body`, `zona`,
// `revoke_reason`) y no el de la cifrada: lo que el AAD identifica es el
// dato, y el dato es el mismo antes y después de cifrarse. Cambiar
// cualquiera de estas cadenas deja ilegible lo cifrado antes.

export function sitioEntrada(tenantId: string, id: string): SitioDelValor {
  return { tenantId, tabla: "clinical_entries", columna: "body", filaId: id };
}

export function sitioAnotacion(tenantId: string, id: string): SitioDelValor {
  return { tenantId, tabla: "clinical_addenda", columna: "body", filaId: id };
}

export function sitioZonaDeFoto(tenantId: string, id: string): SitioDelValor {
  return { tenantId, tabla: "clinical_photos", columna: "zona", filaId: id };
}

export function sitioMotivoDeRetirada(
  tenantId: string,
  id: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "clinical_photos",
    columna: "withdraw_reason",
    filaId: id,
  };
}

export function sitioMotivoDeRevocacion(
  tenantId: string,
  id: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "client_consents",
    columna: "revoke_reason",
    filaId: id,
  };
}

export function sitioCorreccion(tenantId: string, id: string): SitioDelValor {
  return {
    tenantId,
    tabla: "clinical_assessment_corrections",
    columna: "correccion",
    filaId: id,
  };
}

export function sitioNotaDeCita(tenantId: string, id: string): SitioDelValor {
  return { tenantId, tabla: "appointments", columna: "notes", filaId: id };
}

export function sitioNotaDeFicha(tenantId: string, id: string): SitioDelValor {
  return { tenantId, tabla: "clients", columna: "notes", filaId: id };
}

export function sitioNotaTecnica(tenantId: string, id: string): SitioDelValor {
  return {
    tenantId,
    tabla: "client_technical_notes",
    columna: "body",
    filaId: id,
  };
}

// ── residencia-1b · LAS SEIS DE LA RESIDENCIA (D-63) ────────────────
//
// Viven aquí y no en un fichero de residencia por lo mismo que las nueve
// de arriba: el AAD es parte del ciphertext, así que si se armara en dos
// sitios con nombres distintos quedarían filas que no se descifran. No
// hay un segundo esquema de cifrado — se usa el de clinica-7 tal cual.
//
// Y el `filaId` de las tres de `resident_profiles` es el **clientId**,
// porque `client_id` ES la clave primaria de esa tabla (no hay columna
// `id`). Por eso estas tres son las únicas de la casa que no necesitan
// `nuevoIdDeFila()`: el id se sabe antes de insertar porque es el del
// residente.

export function sitioDniDeResidente(
  tenantId: string,
  clientId: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "resident_profiles",
    columna: "dni",
    filaId: clientId,
  };
}

export function sitioNssDeResidente(
  tenantId: string,
  clientId: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "resident_profiles",
    columna: "nss",
    filaId: clientId,
  };
}

export function sitioMotivoDeAlta(
  tenantId: string,
  clientId: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "resident_profiles",
    columna: "discharge_reason",
    filaId: clientId,
  };
}

/** El motivo por el que se ABRIÓ una línea del plan de cuidados. */
export function sitioMotivoDeLinea(
  tenantId: string,
  id: string,
): SitioDelValor {
  return { tenantId, tabla: "care_plan_items", columna: "reason", filaId: id };
}

/** Y el motivo por el que se CERRÓ. Columna lógica distinta a propósito:
 *  con el mismo nombre, el motivo de cierre de una línea se podría copiar
 *  a su motivo de apertura y descifraría. */
export function sitioMotivoDeCierreDeLinea(
  tenantId: string,
  id: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "care_plan_items",
    columna: "close_reason",
    filaId: id,
  };
}

// ── residencia-3 · EL REGISTRO DE CUIDADOS (decisión 6, D-63) ───────
//
// residencia-1b §13 dejó dicho que `CareRecord` «nacerá cifrado en su
// bloque, con su `sitio*` en `cripto-campos.ts` y su CHECK de formato en
// la migración. El sitio donde ponerlo ya está hecho». Aquí está.
//
// **Dos columnas lógicas y no una**, por la misma razón exacta por la que
// el motivo de apertura y el de cierre de una línea del plan son dos: con
// el mismo nombre lógico, el texto de la nota de «algo no va bien» se
// podría copiar a la columna del valor y descifraría — «le huele raro el
// pie» pasaría a ser el valor de un cambio postural.
//
// Y el `filaId` es el uuid que generó **la tablet**, que es el mismo que
// da la idempotencia del envío por lotes. Las dos cosas necesitan el id
// antes de insertar, y en la puerta quien lo sabe antes es la tablet.

/** El valor de un registro: `{"tipo":"BOOL","hecho":true}`,
 *  `{"tipo":"ORDINAL","opcion":"MITAD"}`, `{"tipo":"CONTEO"}`… */
export function sitioValorDeRegistro(
  tenantId: string,
  id: string,
): SitioDelValor {
  return { tenantId, tabla: "care_records", columna: "value", filaId: id };
}

/** Y el texto corto de «algo no va bien». Columna lógica propia. */
export function sitioNotaDeRegistro(
  tenantId: string,
  id: string,
): SitioDelValor {
  return { tenantId, tabla: "care_records", columna: "note", filaId: id };
}

/** Por qué cambió de habitación. */
export function sitioMotivoDeOcupacion(
  tenantId: string,
  id: string,
): SitioDelValor {
  return {
    tenantId,
    tabla: "bed_assignments",
    columna: "reason",
    filaId: id,
  };
}

// ── Escribir ─────────────────────────────────────────────────────────

/** Cifra un texto. `null` entra y `null` sale: una columna vacía se queda
 *  vacía, y cifrar la cadena vacía sería guardar ciphertext que no dice
 *  nada y ocupa sitio. */
export function cifrarTexto(
  claro: string | null | undefined,
  dek: Buffer,
  sitio: SitioDelValor,
): string | null {
  if (claro == null || claro === "") return null;
  return cifrarValor(claro, dek, sitio);
}

/**
 * Cifra un objeto, serializado con `JSON.stringify`.
 *
 * Entero y no campo a campo: cifrando campo a campo las CLAVES del objeto
 * quedarían en claro, y `{"alergias": "…"}` con la clave visible ya dice
 * que ahí hay alergias. Es el mismo argumento por el que el nombre del
 * fichero de una foto no lleva el nombre de la paciente.
 */
export function cifrarJson(
  valor: unknown,
  dek: Buffer,
  sitio: SitioDelValor,
): string {
  return cifrarValor(JSON.stringify(valor), dek, sitio);
}

// ── Leer ─────────────────────────────────────────────────────────────

/** Lo que se enseña en lugar de un valor que no se descifra. No es `null`
 *  a propósito: `null` significa «no había nada», y esto significa «había
 *  algo y no se puede leer», que son dos cosas distintas y la segunda es
 *  la que hay que mirar. */
export const TEXTO_ILEGIBLE = "(este dato no se puede leer)";

/** Y la versión para los cuerpos JSON. La clave `ilegible` es lo que las
 *  pantallas miran para pintar el hueco. */
export const CUERPO_ILEGIBLE: { ilegible: true } = { ilegible: true };

/** Qué hacer con un fallo al descifrar, sin que el llamante tenga que
 *  saber de logs. Se le pasa el logger de la petición cuando lo hay. */
export interface AvisoDeIlegible {
  (sitio: SitioDelValor, err: unknown): void;
}

let avisar: AvisoDeIlegible = () => {};

/**
 * Dónde se cuentan los valores ilegibles.
 *
 * Lo pone `server.ts` al arrancar y los tests lo usan para afirmar que el
 * aviso se da. Un `console.error` fijo aquí habría significado que el test
 * que comprueba «no se registra ni un dato de salud» no puede ver qué se
 * registró.
 */
export function configurarAvisoDeIlegible(fn: AvisoDeIlegible): void {
  avisar = fn;
}

/**
 * El texto de una columna cifrada, con la columna en claro de respaldo.
 *
 * El orden importa y es el del EXPAND: **manda la cifrada**. Si está, se
 * descifra y la clara se ignora (puede estar vaciada al centinela, o
 * puede seguir ahí porque la migración va por fases). Si no está, se
 * devuelve la clara: son las filas que el script de cifrado todavía no ha
 * pasado, y mientras no las pase la historia tiene que seguir leyéndose.
 *
 * Cuando la cifrada está y no se descifra, **no se cae a la clara**: eso
 * convertiría un «la clave no es la buena» en un sistema que parece
 * funcionar leyendo el texto plano que la migración dejó de respaldo. Lo
 * que se devuelve es el hueco marcado.
 */
export function leerTexto(
  fila: { cifrado: string | null; claro: string | null },
  dek: Buffer | null,
  sitio: SitioDelValor,
): string | null {
  if (fila.cifrado == null || !esCifrado(fila.cifrado)) return fila.claro;
  if (dek == null) {
    avisar(sitio, new NoSeDescifra("sin clave para esta clínica"));
    return TEXTO_ILEGIBLE;
  }
  try {
    return descifrarValor(fila.cifrado, dek, sitio);
  } catch (err) {
    avisar(sitio, err);
    return TEXTO_ILEGIBLE;
  }
}

/**
 * El cuerpo JSON de una fila, con el mismo orden de preferencia.
 *
 * Devuelve `CUERPO_ILEGIBLE` cuando no se descifra. El tipo es `unknown`
 * y no `T` a propósito: quien llama ya tenía que validar lo que venía del
 * JSONB (es una columna `Json`, no un tipo), y un `as T` aquí habría
 * escondido que el hueco no tiene la forma de `T`.
 */
export function leerJson(
  fila: { cifrado: string | null; claro: unknown },
  dek: Buffer | null,
  sitio: SitioDelValor,
): unknown {
  if (fila.cifrado == null || !esCifrado(fila.cifrado)) return fila.claro;
  if (dek == null) {
    avisar(sitio, new NoSeDescifra("sin clave para esta clínica"));
    return CUERPO_ILEGIBLE;
  }
  try {
    return JSON.parse(descifrarValor(fila.cifrado, dek, sitio)) as unknown;
  } catch (err) {
    avisar(sitio, err);
    return CUERPO_ILEGIBLE;
  }
}

/** `true` si lo que salió de `leerJson` es el hueco. Lo preguntan las
 *  vistas para pintar el aviso en vez de intentar leer campos de dentro. */
export function esIlegible(valor: unknown): boolean {
  return (
    typeof valor === "object" &&
    valor !== null &&
    (valor as { ilegible?: unknown }).ilegible === true
  );
}

// ── Los cuerpos de la historia, que son los que más se leen ─────────
//
// `clinical_entries.body` y `clinical_addenda.body` se leen en quince
// sitios (la historia paginada, la sesión, el informe, los cobros
// pendientes, las líneas de la sesión, la valoración…). Estas cuatro
// funciones son el único sitio donde se decide qué columna manda y qué
// AAD toca, para que ninguno de esos quince tenga que acordarse.
//
// Y el `select` de cada uno tiene que traer `id` y `tenantId`: el AAD los
// necesita. Era el precio de atar cada valor a su fila (decisión 15), y es
// barato — son dos columnas que ya están en el índice.

/** Lo mínimo que un `select` tiene que traer para poder descifrar un
 *  cuerpo. */
export interface FilaConCuerpo {
  id: string;
  tenantId: string;
  body: unknown;
  bodyCifrado: string | null;
}

/** EL CENTINELA del claro vaciado. Lo escriben las filas nuevas (que
 *  nacen cifradas y nunca guardan el claro) y el script de cifrado al
 *  vaciar las viejas. Un objeto y no `{}` porque el CHECK
 *  `clinical_entries_body_object` exige objeto no vacío — y porque en un
 *  `SELECT` dice qué pasó. */
export const CUERPO_VACIADO = { cifrado: true } as const;

export function cuerpoDeEntrada(f: FilaConCuerpo, dek: Buffer | null): unknown {
  return leerJson(
    { cifrado: f.bodyCifrado, claro: f.body },
    dek,
    sitioEntrada(f.tenantId, f.id),
  );
}

export function cuerpoDeAnotacion(
  f: FilaConCuerpo,
  dek: Buffer | null,
): unknown {
  return leerJson(
    { cifrado: f.bodyCifrado, claro: f.body },
    dek,
    sitioAnotacion(f.tenantId, f.id),
  );
}

/**
 * Lo que un `create` de entrada tiene que escribir en las dos columnas.
 *
 * **El claro va al centinela**, no al cuerpo: una fila que nace cifrada no
 * guarda el dato de salud en claro «por si acaso». El respaldo en claro
 * existe para las filas que YA estaban escritas cuando llegó este bloque,
 * no para las nuevas.
 *
 * `id` entra como parámetro porque lo genera quien llama
 * (`nuevoIdDeFila`): el AAD lo necesita y no se puede leer de una fila que
 * no existe.
 */
export function cuerpoParaEntrada(
  input: { tenantId: string; id: string; cuerpo: unknown; dek: Buffer },
): { body: typeof CUERPO_VACIADO; bodyCifrado: string } {
  return {
    body: CUERPO_VACIADO,
    bodyCifrado: cifrarJson(
      input.cuerpo,
      input.dek,
      sitioEntrada(input.tenantId, input.id),
    ),
  };
}

export function cuerpoParaAnotacion(
  input: { tenantId: string; id: string; cuerpo: unknown; dek: Buffer },
): { body: typeof CUERPO_VACIADO; bodyCifrado: string } {
  return {
    body: CUERPO_VACIADO,
    bodyCifrado: cifrarJson(
      input.cuerpo,
      input.dek,
      sitioAnotacion(input.tenantId, input.id),
    ),
  };
}

// ── La corrección de la valoración, que son dos campos en uno ───────

/** Lo que se cifra en `correccion_cifrada`: la pregunta y el valor juntos.
 *  Separados, `question_id` en claro ya diría de qué habla la fila. */
export interface CorreccionEnClaro {
  preguntaId: string;
  valor: string;
}

export function cifrarCorreccion(
  c: CorreccionEnClaro,
  dek: Buffer,
  sitio: SitioDelValor,
): string {
  return cifrarJson(c, dek, sitio);
}

/**
 * La corrección, de la columna cifrada o de las dos claras.
 *
 * `null` cuando no se descifra: una corrección ilegible no se puede pintar
 * «a medias» (no se sabe de qué pregunta es), así que quien llama la
 * cuenta como lo que es — una corrección que está y no se lee — y lo dice
 * en pantalla. Es el único hueco de este fichero que no tiene forma de
 * texto, porque el dato tampoco la tiene.
 */
export function leerCorreccion(
  fila: {
    correccionCifrada: string | null;
    questionId: string;
    value: string | null;
  },
  dek: Buffer | null,
  sitio: SitioDelValor,
): CorreccionEnClaro | null {
  if (fila.correccionCifrada == null || !esCifrado(fila.correccionCifrada)) {
    // Las filas que el script todavía no pasó. El CHECK
    // `..._dice_algo` garantiza que si no hay cifrado, hay pregunta y
    // valor.
    if (fila.value == null || fila.questionId === "") return null;
    return { preguntaId: fila.questionId, valor: fila.value };
  }
  if (dek == null) {
    avisar(sitio, new NoSeDescifra("sin clave para esta clínica"));
    return null;
  }
  try {
    const leido = JSON.parse(
      descifrarValor(fila.correccionCifrada, dek, sitio),
    ) as Partial<CorreccionEnClaro>;
    if (typeof leido.preguntaId !== "string" || typeof leido.valor !== "string") {
      avisar(sitio, new NoSeDescifra("corrección cifrada con otra forma"));
      return null;
    }
    return { preguntaId: leido.preguntaId, valor: leido.valor };
  } catch (err) {
    avisar(sitio, err);
    return null;
  }
}
