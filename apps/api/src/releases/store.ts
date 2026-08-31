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

/** Lo que se publica en `/apk/latest.json`. Nunca lleva URL del binario. */
export interface PublicReleaseMeta {
  versionCode: number;
  versionName: string;
  sha256: string;
  size: number;
  publishedAt: string;
  gitSha: string;
}

function isReleaseEntry(value: unknown): value is ReleaseEntry {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.versionCode === "number" &&
    Number.isInteger(r.versionCode) &&
    typeof r.versionName === "string" &&
    typeof r.fileName === "string" &&
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
    gitSha: entry.gitSha,
  };
}

export interface OpenedRelease {
  stream: ReturnType<typeof createReadStream>;
  size: number;
  fileName: string;
}

/**
 * Abre el binario para emitirlo por stream (nunca cargado en memoria: son
 * decenas de MB y el proceso también está cobrando).
 *
 * `basename()` sobre el nombre del índice es deliberado: aunque el índice lo
 * escriba nuestro script, un `fileName` con `../` convertiría este endpoint en
 * una lectura arbitraria del sistema de ficheros. El fichero se sirve SIEMPRE
 * desde RELEASES_DIR y de ningún otro sitio.
 */
export async function openRelease(
  entry: ReleaseEntry,
): Promise<OpenedRelease | null> {
  const dir = loadEnv().RELEASES_DIR;
  const safeName = basename(entry.fileName);
  const path = join(dir, safeName);
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    size = info.size;
  } catch {
    return null;
  }
  return { stream: createReadStream(path), size, fileName: safeName };
}
