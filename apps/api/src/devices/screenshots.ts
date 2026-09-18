// A5 · Frente 4 · las capturas de pantalla, y cómo dejan de existir.
//
// **Una captura de la pantalla de un TPV contiene datos de clientes**: nombres,
// teléfonos, lo que ha consumido cada mesa. No es una imagen de soporte
// cualquiera. Todo lo de este módulo sale de ahí:
//
//   - **Retención corta y declarada.** 24 h por defecto
//     (`DEVICE_SCREENSHOT_TTL_HOURS`), escritas en la fila como `expiresAt` y
//     barridas por el worker. Si hace falta otra, se pide otra.
//   - **En el terminal no queda nada.** El PNG se manda y se olvida; no se
//     escribe en el disco de la caja.
//   - **Acceso sólo desde super-admin**, y cada apertura se audita aparte de
//     la petición: mirar la foto es un acceso nuevo a esos datos.
//   - **Motivo obligatorio**, el mismo del comando que la pidió.
//
// El PNG vive en disco (`DEVICE_SCREENSHOT_DIR`, un volumen del VPS) y no en
// Postgres: un blob de 200 KB por captura en la BD que además cobra no aporta
// nada, y borrar un fichero es más fácil de demostrar que borrar una fila.

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { loadEnv } from "../env.js";

/** Lo único que aceptamos: PNG. Nada de decodificar formatos exóticos. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const SCREENSHOT_MIME = "image/png";

export interface CapturaRecibida {
  /** PNG en base64, tal cual lo manda el terminal. */
  pngBase64: string;
}

/**
 * ¿Esto que ha llegado es un PNG?
 *
 * Se comprueba la firma del fichero, no lo que diga el terminal. El binario se
 * va a servir después a un navegador: aceptar cualquier cosa y llamarla PNG es
 * la forma clásica de acabar sirviendo un HTML con script dentro.
 */
export function esPng(buf: Buffer): boolean {
  return buf.length > PNG_MAGIC.length && buf.subarray(0, 8).equals(PNG_MAGIC);
}

export class CapturaInvalida extends Error {}

/** Decodifica y valida lo que mandó el terminal. Lanza `CapturaInvalida`. */
export function decodificarCaptura(datos: unknown): Buffer {
  const png =
    typeof datos === "object" && datos !== null
      ? (datos as { pngBase64?: unknown }).pngBase64
      : undefined;
  if (typeof png !== "string" || png.length === 0) {
    throw new CapturaInvalida("el terminal no devolvió ninguna imagen");
  }
  const buf = Buffer.from(png, "base64");
  if (!esPng(buf)) {
    throw new CapturaInvalida("lo que llegó no es un PNG");
  }
  const env = loadEnv();
  if (buf.byteLength > env.DEVICE_SCREENSHOT_MAX_BYTES) {
    throw new CapturaInvalida(
      `la captura pesa ${buf.byteLength} bytes, por encima del máximo`,
    );
  }
  return buf;
}

export interface GuardarCapturaParams {
  prisma: PrismaClient | Prisma.TransactionClient;
  deviceId: string;
  tenantId: string;
  superAdminId: string;
  commandId: string;
  motivo: string;
  png: Buffer;
  now?: Date;
}

export interface CapturaGuardada {
  screenshotId: string;
  bytes: number;
  expiresAt: Date;
}

/**
 * Escribe el PNG y su fila.
 *
 * El nombre del fichero es el id más el hash del contenido: dos capturas
 * distintas nunca colisionan, y el nombre no dice nada de qué negocio es (los
 * nombres de fichero acaban en listados, logs y capturas de pantalla de quien
 * está depurando).
 */
export async function guardarCaptura(
  params: GuardarCapturaParams,
): Promise<CapturaGuardada> {
  const env = loadEnv();
  const now = params.now ?? new Date();
  const id = randomUUID();
  const huella = createHash("sha256")
    .update(params.png)
    .digest("hex")
    .slice(0, 12);
  const fileName = `${id}-${huella}.png`;

  await mkdir(env.DEVICE_SCREENSHOT_DIR, { recursive: true });
  await writeFile(join(env.DEVICE_SCREENSHOT_DIR, fileName), params.png);

  const expiresAt = new Date(
    now.getTime() + env.DEVICE_SCREENSHOT_TTL_HOURS * 3_600_000,
  );

  await params.prisma.deviceScreenshot.create({
    data: {
      id,
      deviceId: params.deviceId,
      tenantId: params.tenantId,
      requestedBySuperAdminId: params.superAdminId,
      commandId: params.commandId,
      reason: params.motivo,
      fileName,
      bytes: params.png.byteLength,
      mimeType: SCREENSHOT_MIME,
      createdAt: now,
      expiresAt,
    },
  });

  return { screenshotId: id, bytes: params.png.byteLength, expiresAt };
}

/**
 * Nombre de fichero admitido.
 *
 * El nombre sale de nuestra propia BD, pero se valida igual antes de tocar el
 * disco: una fila editada a mano en el VPS no puede convertir esto en un
 * lector de ficheros arbitrarios.
 */
const FILE_NAME_RE = /^[0-9a-f-]{36}-[0-9a-f]{12}\.png$/;

export interface CapturaAbierta {
  stream: ReturnType<typeof createReadStream>;
  bytes: number;
}

/**
 * Abre el fichero de una captura viva. `null` si ya caducó o si el fichero no
 * está (el worker se adelantó, o alguien lo borró a mano).
 */
export async function abrirCaptura(
  fileName: string,
  expiresAt: Date,
  now: Date = new Date(),
): Promise<CapturaAbierta | null> {
  if (!FILE_NAME_RE.test(fileName)) return null;
  // Una captura caducada no se sirve aunque el barrido todavía no haya pasado.
  // La retención es una promesa sobre el acceso, no sobre el `cron`.
  if (expiresAt.getTime() <= now.getTime()) return null;
  const env = loadEnv();
  const ruta = join(env.DEVICE_SCREENSHOT_DIR, fileName);
  try {
    const info = await stat(ruta);
    return { stream: createReadStream(ruta), bytes: info.size };
  } catch {
    return null;
  }
}

export interface PurgaResultado {
  filasBorradas: number;
  ficherosBorrados: number;
  errores: number;
}

/**
 * Borra las capturas caducadas: primero el fichero, después la fila.
 *
 * Ese orden importa. Si se borrara la fila primero y fallara el `unlink`, el
 * PNG se quedaría en el disco para siempre y sin nada que apunte a él: una foto
 * de la pantalla de un cliente que ya nadie sabe que existe. Al revés, un fallo
 * deja la fila y el barrido siguiente lo reintenta.
 *
 * Un fichero que ya no está NO es un error: es el caso normal si el barrido se
 * solapa consigo mismo.
 */
export async function purgarCapturasCaducadas(deps: {
  prisma: {
    deviceScreenshot: {
      findMany(args: unknown): Promise<Array<{ id: string; fileName: string }>>;
      deleteMany(args: unknown): Promise<{ count: number }>;
    };
  };
  dir?: string;
  now?: Date;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<PurgaResultado> {
  const now = deps.now ?? new Date();
  const dir = deps.dir ?? loadEnv().DEVICE_SCREENSHOT_DIR;
  const caducadas = await deps.prisma.deviceScreenshot.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true, fileName: true },
    take: 500,
  });

  let ficherosBorrados = 0;
  let errores = 0;
  const borrables: string[] = [];

  for (const c of caducadas) {
    try {
      await unlink(join(dir, c.fileName));
      ficherosBorrados += 1;
      borrables.push(c.id);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Ya no estaba. La fila sí se va.
        borrables.push(c.id);
      } else {
        errores += 1;
        deps.log?.("no pude borrar una captura caducada", {
          screenshotId: c.id,
          code,
        });
      }
    }
  }

  const { count } = borrables.length
    ? await deps.prisma.deviceScreenshot.deleteMany({
        where: { id: { in: borrables } },
      })
    : { count: 0 };

  return { filasBorradas: count, ficherosBorrados, errores };
}
