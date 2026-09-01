// A3-distribución · el índice de APKs publicadas.
//
// Los binarios NO viven en el repo ni en la imagen Docker: viven en
// RELEASES_DIR (en producción `/opt/mipiacetpv/releases`, montado read-only
// como `/srv/releases`). Este módulo sólo lee ese directorio.
//
// `releases.json` es el índice, lo escribe infra/publicar-apk.sh. La API NUNCA
// lista el directorio: si una versión no está en el índice, no existe. Eso
// evita que un fichero suelto copiado a mano se sirva por accidente, y que un
// error de path convierta el endpoint en un explorador de ficheros.

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { loadEnv } from "../env.js";

export interface ReleaseEntry {
  versionCode: number;
  versionName: string;
  fileName: string;
  sha256: string;
  size: number;
  publishedAt: string;
  /** Commit del que salió el build. `<sha>-dirty` si el árbol estaba sucio. */
  gitSha: string;
}

/**
 * Lo que se publica en `/apk/latest.json`. Nunca lleva URL del binario.
 *
 * Tampoco lleva `gitSha`: ese endpoint es público y sin sesión, y el commit
 * del build es información de dentro (dice qué hay desplegado y contra qué
 * árbol mirar). Se queda en `/super-admin/releases`, que sí pide sesión.
 */
export interface PublicReleaseMeta {
  versionCode: number;
  versionName: string;
  sha256: string;
  size: number;
  publishedAt: string;
}

/**
 * Nombre de fichero admitido en el índice.
 *
 * `basename()` en `openRelease` ya impide salir de RELEASES_DIR, pero el
 * nombre viaja además CRUDO dentro de `Content-Disposition`. Un `"` cierra el
 * filename y un CR/LF parte la cabecera: Node rechaza el valor con
 * ERR_INVALID_CHAR y la descarga se convierte en un 500 en la cara del
 * instalador (o, en un servidor menos estricto, en una cabecera inyectada).
 * El índice es un fichero editable a mano en el VPS, así que el nombre se
 * valida aquí y una entrada con un nombre raro sencillamente no existe.
 */
const FILE_NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

function isReleaseEntry(value: unknown): value is ReleaseEntry {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.versionCode === "number" &&
    Number.isInteger(r.versionCode) &&
    typeof r.versionName === "string" &&
    typeof r.fileName === "string" &&
    FILE_NAME_RE.test(r.fileName) &&
    typeof r.sha256 === "string" &&
    typeof r.size === "number" &&
    typeof r.publishedAt === "string" &&
    typeof r.gitSha === "string"
  );
}

/**
 * Índice completo, ordenado de más nueva a más vieja.
 *
 * Devuelve [] —no lanza— si el directorio no existe o el índice está corrupto:
 * en dev nadie ha publicado nada, y en producción un índice roto debe dar 404
 * en la página de descarga, no tumbar el arranque de la API que además cobra.
 */
export async function readReleases(): Promise<ReleaseEntry[]> {
  const dir = loadEnv().RELEASES_DIR;
  let raw: string;
  try {
    raw = await readFile(join(dir, "releases.json"), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isReleaseEntry)
    .sort((a, b) => b.versionCode - a.versionCode);
}

export async function findRelease(
  versionCode: number,
): Promise<ReleaseEntry | null> {
  const all = await readReleases();
  return all.find((r) => r.versionCode === versionCode) ?? null;
}

export async function latestRelease(): Promise<ReleaseEntry | null> {
  const all = await readReleases();
  return all[0] ?? null;
}

export function toPublicMeta(entry: ReleaseEntry): PublicReleaseMeta {
  // Campo a campo, nunca por spread: así añadir una columna interna al índice
  // (una ruta, una nota) no la publica sola en /apk/latest.json.
  return {
    versionCode: entry.versionCode,
    versionName: entry.versionName,
    sha256: entry.sha256,
    size: entry.size,
    publishedAt: entry.publishedAt,
  };
}

export interface OpenedRelease {
  stream: ReturnType<typeof createReadStream>;
  size: number;
  fileName: string;
}

interface LocatedRelease {
  path: string;
  fileName: string;
  size: number;
}

/**
 * Resuelve la entrada del índice a un fichero real. NO abre nada.
 *
 * `basename()` sobre el nombre del índice es deliberado: aunque el índice lo
 * escriba nuestro script, un `fileName` con `../` convertiría este endpoint en
 * una lectura arbitraria del sistema de ficheros. El fichero se sirve SIEMPRE
 * desde RELEASES_DIR y de ningún otro sitio.
 */
async function locateRelease(
  entry: ReleaseEntry,
): Promise<LocatedRelease | null> {
  const dir = loadEnv().RELEASES_DIR;
  const fileName = basename(entry.fileName);
  const path = join(dir, fileName);
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { path, fileName, size: info.size };
  } catch {
    return null;
  }
}

/**
 * ¿Está el binario de verdad en disco? Sólo `stat`.
 *
 * Existe separada de `openRelease` para que `POST /apk` pueda comprobar el
 * fichero ANTES del claim sin dejar un descriptor abierto durante el claim y
 * la auditoría. Abrir antes obligaría a cerrar a mano en cada salida, y la
 * salida que no se ve venir —una excepción de Prisma en el `updateMany` o en
 * `writeAudit`— se saltaría ese cierre y fugaría el fd: en un endpoint
 * público eso es un goteo de descriptores que tumba el proceso que además
 * está cobrando.
 */
export async function releaseFileExists(entry: ReleaseEntry): Promise<boolean> {
  return (await locateRelease(entry)) !== null;
}

/**
 * Abre el binario para emitirlo por stream (nunca cargado en memoria: son
 * decenas de MB y el proceso también está cobrando).
 *
 * Se llama lo más tarde posible, con la descarga ya cobrada y sin nada entre
 * esto y el `send`: mientras haya un descriptor abierto no puede haber ningún
 * `await` que pueda lanzar.
 */
export async function openRelease(
  entry: ReleaseEntry,
): Promise<OpenedRelease | null> {
  const found = await locateRelease(entry);
  if (!found) return null;
  return {
    stream: createReadStream(found.path),
    size: found.size,
    fileName: found.fileName,
  };
}
