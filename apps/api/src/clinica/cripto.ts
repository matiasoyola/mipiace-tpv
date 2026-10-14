// clinica-7 · EL CIFRADO DE LO CLÍNICO. Las primitivas, sin base de datos.
//
// Lo que este fichero hace y lo que no:
//
//   · **Hace**: cifrar y descifrar un valor con una DEK y su AAD, envolver
//     y desenvolver una DEK con la KEK, cifrar y descifrar un fichero, y
//     construir el AAD. Todo con `Buffer` y `node:crypto`, sin Prisma.
//   · **No hace**: saber de dónde sale la DEK. Eso es `claves.ts`, que es
//     quien habla con la base y cachea. La separación importa: así los
//     tests del cifrado no necesitan base de datos, y los de las claves no
//     necesitan entender GCM.
//
// ── La jerarquía, en dos frases ───────────────────────────────────────
//
// **KEK** (clave maestra) vive en `CLINICAL_KEK`, en el entorno, nunca en
// la base. Envuelve la **DEK** de cada clínica, que sí vive en la base
// (`clinical_tenant_keys.dek_wrapped`) y cifra todo lo de esa clínica.
//
// Lo que se gana, y es TODO el bloque: una copia de seguridad filtrada
// trae las DEK envueltas y no trae la KEK, así que no se lee ni una
// historia. Y borrar la DEK de una clínica deja ilegibles sus datos en
// todas las copias pasadas — crypto-shredding, que es la única forma real
// de «destruir» del art. 28.3.g.
//
// ── Dos prefijos, y se distinguen a simple vista ─────────────────────
//
//   `v1:` — envuelto con la KEK. Hoy: las DEK. Lo pone `crypto.ts`, que es
//           la única implementación de AES-GCM de la casa.
//   `c1:` — cifrado con una DEK. Todo el texto clínico y el canario.
//
// Un `SELECT` sobre la base dice de un vistazo qué es cada cosa, y el
// CHECK de cada columna sólo admite el suyo: una DEK en claro no cabe en
// `dek_wrapped` y un diagnóstico en claro no cabe en `body_cifrado`.
//
// ── Y el AAD: cada valor atado a dónde vive ──────────────────────────
//
// Decisión 15. Cada valor cifrado se ata a
// `tenantId|tabla|columna|id de fila`, y el AAD entra en el tag de GCM.
// Consecuencia concreta: **un texto copiado de la fila de un paciente a la
// de otro no se descifra** — ni dentro de la misma clínica, ni entre
// clínicas. No «se descifra mal»: da error de autenticación, que es lo que
// hace que el fallo se vea en vez de convertirse en una historia con el
// cuerpo de otra persona dentro.
//
// El AAD lo construye UNA función (`aadDe`). Dos formas de armarlo serían
// dos AAD distintos para el mismo valor, y el que no cuadrara dejaría una
// fila ilegible para siempre.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "../crypto.js";

const ALG = "aes-256-gcm" as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** El prefijo de un valor cifrado con una DEK. Lo exige el CHECK de cada
 *  columna cifrada; cambiarlo es una migración. */
export const PREFIJO_CLINICO = "c1:";

/** La cabecera binaria de un fichero clínico cifrado. Cuatro bytes que se
 *  leen en un `head -c 4` y dicen qué es: «Mi Piace Clínico v1». */
export const MAGIA_FICHERO = Buffer.from("MPC1", "latin1");

export const BYTES_DE_DEK = 32;

/** Lo que el canario dice en claro. Fijo y sin nada de nadie dentro: su
 *  trabajo es cuadrar, no significar. */
export const TEXTO_DEL_CANARIO = "mipiace-canario-clinico-v1";

export class CriptoClinicaError extends Error {}

/** Un valor cifrado no se puede descifrar. Clase propia porque quien llama
 *  decide: el arranque no arranca, una lectura devuelve el hueco marcado y
 *  el script de verificación cuenta la fila como fallida. */
export class NoSeDescifra extends CriptoClinicaError {}

// ── El AAD ────────────────────────────────────────────────────────────

/** De dónde es un valor cifrado. Los cuatro, siempre. */
export interface SitioDelValor {
  tenantId: string;
  /** El nombre de la TABLA en la base (`clinical_entries`), no el del
   *  modelo de Prisma: lo que el AAD ata es la fila, y la fila vive en una
   *  tabla. */
  tabla: string;
  /** El nombre lógico de la columna (`body`, `zona`, `correccion`). */
  columna: string;
  /** El id de la fila. Para `clinical_tenant_keys` es el `tenantId`, que
   *  es su clave primaria. */
  filaId: string;
}

/**
 * EL AAD, en una sola función.
 *
 * El separador es `|` y los cuatro campos van en este orden. Es parte del
 * contrato del ciphertext: cambiar el orden o el separador deja ilegible
 * todo lo cifrado antes, igual que cambiar el formato. Si un día hace
 * falta, se hace con una versión nueva de prefijo y una migración, no
 * tocando esta línea.
 *
 * Ninguno de los cuatro campos puede llevar `|` (son uuids y nombres de
 * columna), así que no hay ambigüedad al componerlos.
 */
export function aadDe(sitio: SitioDelValor): string {
  return `${sitio.tenantId}|${sitio.tabla}|${sitio.columna}|${sitio.filaId}`;
}

// ── La DEK: envolver y desenvolver ───────────────────────────────────

/** Una DEK nueva. 32 bytes del CSPRNG del sistema y nada más. */
export function nuevaDek(): Buffer {
  return randomBytes(BYTES_DE_DEK);
}

/**
 * Envuelve una DEK con la KEK.
 *
 * El AAD es `tenantId|kekId`: una DEK envuelta copiada a la fila de otro
 * tenant no se desenvuelve, y una envuelta con la KEK vieja no se
 * desenvuelve diciendo que es de la nueva. Las dos cosas son lo que impide
 * que un `UPDATE` a mano mezcle las claves de dos clínicas.
 */
export function envolverDek(
  dek: Buffer,
  input: { kekBase64: string; kekId: string; tenantId: string },
): string {
  if (dek.length !== BYTES_DE_DEK) {
    throw new CriptoClinicaError(
      `la DEK debe ser de ${BYTES_DE_DEK} bytes, y es de ${dek.length}`,
    );
  }
  return encryptSecret(
    dek.toString("base64"),
    input.kekBase64,
    aadDeLaDek(input.tenantId, input.kekId),
  );
}

export function desenvolverDek(
  envuelta: string,
  input: { kekBase64: string; kekId: string; tenantId: string },
): Buffer {
  let base64: string;
  try {
    base64 = decryptSecret(
      envuelta,
      input.kekBase64,
      aadDeLaDek(input.tenantId, input.kekId),
    );
  } catch {
    // SIN el error de dentro y sin la clave: lo que se dice es QUÉ no
    // cuadra, no con qué se intentó. Un mensaje con la KEK dentro acaba en
    // un log.
    throw new NoSeDescifra(
      `la clave de la clínica ${input.tenantId} no se desenvuelve con la KEK ${input.kekId}`,
    );
  }
  const dek = Buffer.from(base64, "base64");
  if (dek.length !== BYTES_DE_DEK) {
    throw new NoSeDescifra(
      `la clave de la clínica ${input.tenantId} se desenvolvió con un tamaño que no es de DEK`,
    );
  }
  return dek;
}

function aadDeLaDek(tenantId: string, kekId: string): string {
  return `${tenantId}|${kekId}`;
}

// ── Los valores: cifrar y descifrar ──────────────────────────────────

/**
 * Cifra un valor con la DEK de su clínica, atado a dónde vive.
 *
 * Devuelve `c1:` + base64 de `IV(12) || tag(16) || ciphertext`. Mismo
 * serializado que `crypto.ts`, con otro prefijo porque la clave es otra.
 */
export function cifrarValor(
  claro: string,
  dek: Buffer,
  sitio: SitioDelValor,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, dek, iv);
  cipher.setAAD(Buffer.from(aadDe(sitio), "utf8"));
  const ct = Buffer.concat([cipher.update(claro, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIJO_CLINICO + Buffer.concat([iv, tag, ct]).toString("base64")
  );
}

/**
 * Descifra un valor. Levanta `NoSeDescifra` si el AAD no es el de ese
 * valor — o sea, si el ciphertext viene de otra fila, otra columna u otra
 * clínica.
 *
 * **El mensaje del error no lleva ni el ciphertext ni la clave ni la
 * fila entera**: lleva la tabla, la columna y el id, que es lo que hace
 * falta para encontrarla. Es la misma regla que `registro.ts`: los
 * `catch` de esta casa no tocan el contenido.
 */
export function descifrarValor(
  cifrado: string,
  dek: Buffer,
  sitio: SitioDelValor,
): string {
  if (!cifrado.startsWith(PREFIJO_CLINICO)) {
    throw new NoSeDescifra(
      `valor clínico con formato desconocido en ${sitio.tabla}.${sitio.columna} (${sitio.filaId})`,
    );
  }
  const data = Buffer.from(cifrado.slice(PREFIJO_CLINICO.length), "base64");
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new NoSeDescifra(
      `valor clínico demasiado corto en ${sitio.tabla}.${sitio.columna} (${sitio.filaId})`,
    );
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = data.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALG, dek, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aadDe(sitio), "utf8"));
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new NoSeDescifra(
      `valor clínico que no se descifra en ${sitio.tabla}.${sitio.columna} (${sitio.filaId}): la clave o el sitio no son los suyos`,
    );
  }
}

/** `true` si esto ya es ciphertext clínico. Lo usan el script de cifrado
 *  (para no cifrar dos veces) y los tests de guardia. */
export function esCifrado(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor.startsWith(PREFIJO_CLINICO);
}

// ── El canario ───────────────────────────────────────────────────────

/**
 * El canario de un tenant: `TEXTO_DEL_CANARIO` cifrado con su DEK.
 *
 * Su AAD apunta a su propia fila (`clinical_tenant_keys.canario`, con el
 * `tenantId` como id), así que el canario de una clínica copiado a la fila
 * de otra tampoco cuadra. Es lo que convierte la comprobación del arranque
 * en algo que no se puede falsear copiando una fila.
 */
export function sitioDelCanario(tenantId: string): SitioDelValor {
  return {
    tenantId,
    tabla: "clinical_tenant_keys",
    columna: "canario",
    filaId: tenantId,
  };
}

export function nuevoCanario(dek: Buffer, tenantId: string): string {
  return cifrarValor(TEXTO_DEL_CANARIO, dek, sitioDelCanario(tenantId));
}

/**
 * ¿El canario de este tenant cuadra con esta DEK?
 *
 * `false` y no una excepción: quien llama es el arranque, y lo que el
 * arranque quiere es la lista de clínicas que no cuadran para decirla toda
 * de una vez en el log. Reventar en la primera dejaría al operador
 * arreglando una de cinco.
 */
export function canarioCuadra(
  canario: string,
  dek: Buffer,
  tenantId: string,
): boolean {
  try {
    return (
      descifrarValor(canario, dek, sitioDelCanario(tenantId)) ===
      TEXTO_DEL_CANARIO
    );
  } catch {
    return false;
  }
}

// ── Los ficheros ─────────────────────────────────────────────────────

/**
 * Cifra un fichero clínico. Cabecera binaria y no base64:
 *
 *     MPC1 (4) || IV (12) || tag (16) || ciphertext
 *
 * Binario porque un JPEG en base64 pesa un tercio más y aquí hay fotos de
 * 300 KB por sesión; la cabecera cumple lo mismo que el prefijo `c1:`
 * —dice qué formato es y en qué versión— y se lee igual de fácil
 * (`head -c 4`). Cambiar el formato es migración, y por eso la versión va
 * dentro.
 *
 * ── Y la huella sigue siendo la del contenido EN CLARO ──────────────
 *
 * Decisión 8. La SHA-256 que se guarda en la fila y la que se comprueba al
 * leer son las del JPEG, no las del fichero cifrado. Es lo que hace que un
 * fichero manipulado se siga detectando: con la huella del cifrado, el
 * único cambio que se detectaría es el del envoltorio, y el GCM ya lo
 * detecta solo. Comprobar la huella del claro es comprobar que lo que sale
 * es lo que entró.
 */
export function cifrarFichero(
  claro: Buffer,
  dek: Buffer,
  sitio: SitioDelValor,
): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, dek, iv);
  cipher.setAAD(Buffer.from(aadDe(sitio), "utf8"));
  const ct = Buffer.concat([cipher.update(claro), cipher.final()]);
  return Buffer.concat([MAGIA_FICHERO, iv, cipher.getAuthTag(), ct]);
}

export function descifrarFichero(
  cifrado: Buffer,
  dek: Buffer,
  sitio: SitioDelValor,
): Buffer {
  if (!esFicheroCifrado(cifrado)) {
    throw new NoSeDescifra(
      `fichero clínico sin la cabecera de cifrado (${sitio.columna}/${sitio.filaId})`,
    );
  }
  const base = MAGIA_FICHERO.length;
  const iv = cifrado.subarray(base, base + IV_BYTES);
  const tag = cifrado.subarray(base + IV_BYTES, base + IV_BYTES + TAG_BYTES);
  const ct = cifrado.subarray(base + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALG, dek, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aadDe(sitio), "utf8"));
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new NoSeDescifra(
      `fichero clínico que no se descifra (${sitio.columna}/${sitio.filaId}): la clave o el sitio no son los suyos`,
    );
  }
}

/**
 * ¿Este fichero del disco está ya cifrado?
 *
 * Lo necesitan dos sitios, y por eso es una función y no un `if`: el
 * script de cifrado (para ser idempotente y no cifrar dos veces lo mismo)
 * y la lectura (para seguir sirviendo los ficheros que todavía están en
 * claro mientras la migración no haya acabado).
 *
 * Y es seguro contra el caso que da miedo: **ningún JPEG ni ningún PDF
 * empieza por `MPC1`** — un JPEG empieza por `FF D8 FF` y un PDF por
 * `%PDF-`, y las dos firmas se comprueban al escribir (`esJpeg`, `esPdf`).
 */
export function esFicheroCifrado(buf: Buffer): boolean {
  return (
    buf.length >= MAGIA_FICHERO.length + IV_BYTES + TAG_BYTES &&
    buf.subarray(0, MAGIA_FICHERO.length).equals(MAGIA_FICHERO)
  );
}

/** El sitio de un fichero clínico. La «columna» es su clase (FOTO,
 *  CONSENTIMIENTO, INFORME) y la «fila» su nombre de fichero, que es
 *  único en todo el volumen. */
export function sitioDelFichero(input: {
  tenantId: string;
  clase: string;
  fileName: string;
}): SitioDelValor {
  return {
    tenantId: input.tenantId,
    tabla: "clinical_files",
    columna: input.clase,
    filaId: input.fileName,
  };
}
