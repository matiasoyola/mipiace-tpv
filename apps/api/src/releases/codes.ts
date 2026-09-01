// A3-distribución · códigos de instalación de 6 dígitos.
//
// Mismo patrón que los pairing codes de terminales
// (apps/api/src/devices/routes.ts): generar, reintentar ante colisión viva,
// purgar el caducado para poder reutilizar el número, y consumir de forma
// ATÓMICA con updateMany. Nada de leer-y-luego-escribir: dos instaladores
// tirando del mismo código a la vez se repartirían descargas que no existen.

import { randomInt } from "node:crypto";

import type { PrismaClient } from "@mipiacetpv/db";

/** 60 min: una instalación cabe de sobra, y un código olvidado caduca solo. */
export const CODE_TTL_MINUTES = 60;
/** 3 descargas: el WiFi del bar corta y el instalador reintenta. */
export const DEFAULT_MAX_DOWNLOADS = 3;

const MAX_GENERATION_ATTEMPTS = 10;

export function newSixDigitCode(): string {
  // randomInt evita bias. Seis dígitos con los ceros a la izquierda intactos.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export interface CreatedCode {
  code: string;
  expiresAt: Date;
  maxDownloads: number;
}

/**
 * Emite un código para una versión. Devuelve null si tras varios intentos
 * todos los números sorteados seguían vivos (con 3 códigos activos sobre un
 * millón esto no pasa; el bucle es una red, no una estrategia).
 */
export async function createDownloadCode(params: {
  prisma: PrismaClient;
  versionCode: number;
  superAdminId: string;
  note: string | null;
  now?: Date;
}): Promise<CreatedCode | null> {
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

  for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i++) {
    const code = newSixDigitCode();
    const existing = await params.prisma.apkDownloadCode.findUnique({
      where: { code },
      select: { id: true, expiresAt: true, downloadCount: true, maxDownloads: true },
    });

    if (existing) {
      const vivo =
        existing.expiresAt > now &&
        existing.downloadCount < existing.maxDownloads;
      // Un código vivo es de otra instalación en curso: no se toca.
      if (vivo) continue;
      // Caducado o agotado: se borra para liberar el número. Sin esto el
      // espacio de 6 dígitos se lo come el histórico.
      await params.prisma.apkDownloadCode.delete({ where: { id: existing.id } });
    }

    const created = await params.prisma.apkDownloadCode.create({
      data: {
        code,
        versionCode: params.versionCode,
        createdBySuperAdminId: params.superAdminId,
        expiresAt,
        maxDownloads: DEFAULT_MAX_DOWNLOADS,
        note: params.note,
      },
      select: { code: true, expiresAt: true, maxDownloads: true },
    });
    return created;
  }
  return null;
}

/**
 * Mira de qué versión es un código SIN gastar nada.
 *
 * Existe para poder comprobar que el binario está en disco antes del claim:
 * si no, un código bueno apuntando a una versión que ya no está en
 * RELEASES_DIR quema una de sus 3 descargas para acabar en un 404, y el
 * instalador se queda con dos intentos y sin APK. No decide nada de
 * caducidad ni de límite: eso sigue siendo cosa del `updateMany` atómico.
 */
export async function peekDownloadCode(params: {
  prisma: PrismaClient;
  code: string;
}): Promise<{ versionCode: number } | null> {
  const row = await params.prisma.apkDownloadCode.findUnique({
    where: { code: params.code },
    select: { versionCode: true },
  });
  return row ? { versionCode: row.versionCode } : null;
}

export type ConsumeResult =
  | { status: "ok"; versionCode: number; superAdminId: string }
  | { status: "caducado" | "agotado"; versionCode: number; superAdminId: string }
  | { status: "desconocido" };

/**
 * Gasta una descarga del código, atómicamente.
 *
 * El `updateMany` con las condiciones dentro del WHERE es lo que hace que dos
 * peticiones simultáneas no puedan pasar del límite: la segunda ve count 0.
 * Sólo cuando falla se vuelve a leer la fila, y sólo para distinguir caducado
 * de agotado — que es lo que la página le dice al instalador y lo que va a la
 * auditoría.
 */
export async function consumeDownloadCode(params: {
  prisma: PrismaClient;
  code: string;
  ip: string | null;
  now?: Date;
}): Promise<ConsumeResult> {
  const now = params.now ?? new Date();

  // Lectura previa SÓLO para conocer el límite de esta fila y, si el claim
  // falla, poder decir por qué. No decide nada por sí sola: la condición que
  // manda es la del WHERE del updateMany de abajo.
  const row = await params.prisma.apkDownloadCode.findUnique({
    where: { code: params.code },
    select: {
      versionCode: true,
      createdBySuperAdminId: true,
      expiresAt: true,
      downloadCount: true,
      maxDownloads: true,
    },
  });
  if (!row) return { status: "desconocido" };

  // El claim es atómico: las condiciones viajan DENTRO del UPDATE, así que
  // Postgres resuelve la carrera. Dos instaladores tirando a la vez del
  // último uso disponible no pueden pasar los dos — el segundo ve count 0.
  //
  // `maxDownloads` entra como número leído arriba en vez de como referencia a
  // la columna (Prisma sólo compara columna contra columna con el preview
  // `fieldReference`, que este schema no activa). No debilita nada: nadie
  // edita el límite de un código ya emitido, y aunque lo hiciera, el WHERE
  // sigue acotando el contador en el propio UPDATE.
  const claimed = await params.prisma.apkDownloadCode.updateMany({
    where: {
      code: params.code,
      expiresAt: { gt: now },
      downloadCount: { lt: row.maxDownloads },
    },
    data: {
      downloadCount: { increment: 1 },
      lastDownloadIp: params.ip,
      lastDownloadAt: now,
    },
  });

  if (claimed.count > 0) {
    return {
      status: "ok",
      versionCode: row.versionCode,
      superAdminId: row.createdBySuperAdminId,
    };
  }
  return {
    status: row.expiresAt <= now ? "caducado" : "agotado",
    versionCode: row.versionCode,
    superAdminId: row.createdBySuperAdminId,
  };
}
