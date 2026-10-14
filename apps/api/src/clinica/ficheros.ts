// clinica-4 · EL ALMACÉN DE FICHEROS CLÍNICOS.
//
// Las fotos de los pies y los PDF de consentimientos e informes. Un solo
// sitio que sabe escribir, leer y comprobar, para los tres.
//
// ── Fuera de la base y fuera de todo lo que se sirve en estático ──────
//
// Decisión 11 del prompt, y es la decisión de fondo de esta pieza:
//
//   · **No en Postgres.** Un JPEG por foto en una base que además se
//     copia entera cada noche no aporta nada que un volumen no dé.
//   · **No en `product_images`.** Ese directorio lo lee Caddy: lo que cae
//     ahí se sirve con una URL y sin sesión. Una foto de la uña de una
//     paciente servida por Caddy es una foto pública con una URL difícil
//     de adivinar, que no es lo mismo que una foto protegida.
//   · **No detrás de ninguna URL estática**, ni con nombre aleatorio. El
//     binario sale por la API, por `conHistoria`, y cada apertura deja su
//     línea en `ClinicalAccessLog`.
//
// ── El nombre del fichero no dice nada del paciente ──────────────────
//
// `<uuid>-<12 hex de la huella>.<ext>`. Mismo criterio que las capturas de
// A5: los nombres de fichero acaban en listados, en logs y en la captura
// de pantalla de quien está depurando. «carmen-rodriguez-dedo-gordo.jpg»
// sería un dato de salud en el nombre de un fichero.
//
// ── Y la huella se calcula una sola vez, aquí ─────────────────────────
//
// La SHA-256 que se guarda en la fila es la del contenido que se escribió,
// y la que se comprueba al leer es la del contenido que se leyó. Si
// hubiera dos sitios que la calcularan, la que no cuadrara sería la de
// alguien que cambió el fichero y nadie lo sabría.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadEnv } from "../env.js";

/** Lo que este almacén guarda. Cada clase, su carpeta y su extensión. */
export type ClaseDeFichero = "FOTO" | "CONSENTIMIENTO" | "INFORME";

const CARPETA: Record<ClaseDeFichero, string> = {
  FOTO: "fotos",
  CONSENTIMIENTO: "consentimientos",
  INFORME: "informes",
};

const EXTENSION: Record<ClaseDeFichero, string> = {
  FOTO: "jpg",
  CONSENTIMIENTO: "pdf",
  INFORME: "pdf",
};

export const MIME_DE_FOTO = "image/jpeg";
export const MIME_DE_PDF = "application/pdf";

/**
 * Las firmas de los dos formatos que entran.
 *
 * Se comprueba **la firma del fichero, no lo que diga quien lo manda**: el
 * binario se va a servir después a un navegador, y aceptar cualquier cosa
 * y llamarla JPEG es la forma clásica de acabar sirviendo un HTML con
 * script dentro. Es la misma comprobación que `esPng` de A5.
 */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_MAGIC = Buffer.from("%PDF-", "latin1");

export function esJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf.subarray(0, 3).equals(JPEG_MAGIC);
}

export function esPdf(buf: Buffer): boolean {
  return buf.length > 5 && buf.subarray(0, 5).equals(PDF_MAGIC);
}

export class FotoInvalida extends Error {}

/** La huella del contenido, en hex. 64 caracteres. */
export function huellaDe(contenido: Buffer | Uint8Array): string {
  return createHash("sha256").update(contenido).digest("hex");
}

/**
 * Decodifica y valida la foto que mandó la tablet.
 *
 * Llega en base64 porque sale de un `<canvas>` del navegador
 * (`toDataURL`), igual que la captura de un terminal: un `multipart` por
 * una foto obligaría a montar el plugin de subida de Fastify para un solo
 * endpoint.
 */
export function decodificarFoto(datos: unknown): Buffer {
  const jpeg =
    typeof datos === "object" && datos !== null
      ? (datos as { jpegBase64?: unknown }).jpegBase64
      : undefined;
  if (typeof jpeg !== "string" || jpeg.length === 0) {
    throw new FotoInvalida("No llegó ninguna imagen.");
  }
  const buf = Buffer.from(jpeg, "base64");
  if (!esJpeg(buf)) {
    throw new FotoInvalida("Lo que llegó no es una foto JPEG.");
  }
  const env = loadEnv();
  if (buf.byteLength > env.CLINICAL_PHOTO_MAX_BYTES) {
    throw new FotoInvalida(
      "La foto pesa demasiado. Vuelve a hacerla; si sigue, avisa a Mi Piace.",
    );
  }
  return buf;
}

export interface FicheroGuardado {
  fileName: string;
  sha256: string;
  bytes: number;
}

/** Nombre admitido. Se valida ANTES de tocar el disco. */
const FILE_NAME_RE = /^[0-9a-f-]{36}-[0-9a-f]{12}\.(jpg|pdf)$/;

function directorioDe(clase: ClaseDeFichero): string {
  return join(loadEnv().CLINICAL_FILES_DIR, CARPETA[clase]);
}

/**
 * Escribe un fichero clínico y devuelve con qué nombre y qué huella.
 *
 * No escribe ninguna fila: eso es de quien llama, que es quien está en su
 * transacción. El orden que SÍ importa está en las rutas: **primero el
 * fichero, después la fila**. Al revés, un fallo al escribir el disco
 * dejaría una fila que apunta a una foto que no existe — y en una
 * historia clínica un hueco que dice «aquí había una foto» es peor que no
 * tener la fila.
 */
export async function guardarFichero(
  clase: ClaseDeFichero,
  contenido: Buffer | Uint8Array,
): Promise<FicheroGuardado> {
  const buf = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido);
  const sha256 = huellaDe(buf);
  const fileName = `${randomUUID()}-${sha256.slice(0, 12)}.${EXTENSION[clase]}`;
  const dir = directorioDe(clase);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), buf);
  return { fileName, sha256, bytes: buf.byteLength };
}

export interface FicheroLeido {
  contenido: Buffer;
  bytes: number;
  /** `true` si la huella del disco coincide con la que dice la fila. */
  huellaCuadra: boolean;
}

/**
 * Lee un fichero clínico y **comprueba su huella**.
 *
 * `null` si el nombre no es admisible o el fichero no está. Que la huella
 * no cuadre NO es un `null`: el fichero se devuelve con el aviso, y quien
 * llama decide. Y en las rutas de este bloque la decisión es enseñarlo
 * igual con el aviso, no esconderlo: un consentimiento cuyo PDF no cuadra
 * es justo el documento que alguien tiene que mirar. Esconderlo sería
 * borrar la única pista.
 */
export async function leerFichero(
  clase: ClaseDeFichero,
  fileName: string,
  sha256Esperada: string | null,
): Promise<FicheroLeido | null> {
  if (!FILE_NAME_RE.test(fileName)) return null;
  const ruta = join(directorioDe(clase), fileName);
  try {
    const info = await stat(ruta);
    const contenido = await readFile(ruta);
    return {
      contenido,
      bytes: info.size,
      huellaCuadra:
        sha256Esperada == null ? true : huellaDe(contenido) === sha256Esperada,
    };
  } catch {
    return null;
  }
}

/** Para el `-done` y para el script de copia: dónde viven. */
export function carpetasDeFicherosClinicos(): readonly string[] {
  const raiz = loadEnv().CLINICAL_FILES_DIR;
  return (Object.keys(CARPETA) as ClaseDeFichero[]).map((c) =>
    join(raiz, CARPETA[c]),
  );
}
