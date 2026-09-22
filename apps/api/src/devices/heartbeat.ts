// A5 · lo que el terminal cuenta de sí mismo por el canal de soporte.
//
// El terminal publica una instantánea al conectar y luego cada
// HEARTBEAT_INTERVAL_MS. Aquí se valida y se persiste en `DeviceHeartbeat`
// (una fila por device, sobreescrita).
//
// Dos reglas que importan y que NO delegamos en el terminal:
//
//   1. La hora de referencia es la del SERVIDOR. La del terminal se guarda
//      aparte, junto con el desvío ya calculado, porque una hora desviada es
//      exactamente lo que explica los errores raros que nos hacen mirar.
//   2. `outboxStuckSince` lo lleva el servidor. El terminal sólo dice cuántos
//      elementos tiene pendientes; desde cuándo lo arrastra lo sabemos
//      nosotros, que somos los que no perdemos la memoria al reiniciar.
//
// TODOS los campos que manda el terminal son opcionales. Un terminal viejo, o
// uno cuyo plugin nativo no responde, tiene que poder anunciarse igual: una
// columna vacía se pinta «—» en el panel, pero un heartbeat rechazado nos deja
// sin ver el terminal, que es lo contrario de lo que hace este bloque.

import { z } from "zod";

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

/** Cada cuánto pide el servidor que el terminal publique su estado. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Margen antes de dar por muerto un canal que no habla. Dos latidos perdidos
 * más un respiro: por debajo de esto, un terminal con la red del bar a
 * trompicones aparecería y desaparecería del panel cada minuto.
 */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2 + 15_000;

// Longitudes acotadas en todo lo que es texto libre: esto viene de fuera y va
// a una columna de Postgres. No hay secretos aquí (el token viaja sólo en el
// `hello` y no se persiste ni se loguea nunca).
export const DeviceStatusSchema = z
  .object({
    bundleBuildHash: z.string().max(80).optional(),
    bundleTarget: z.string().max(40).optional(),
    platform: z.enum(["web", "android"]).optional(),
    appVersionName: z.string().max(40).optional(),
    appVersionCode: z.number().int().nonnegative().max(99_999_999).optional(),
    shiftOpen: z.boolean().optional(),
    shiftOpenedAt: z.string().datetime().optional(),
    outboxPending: z.number().int().nonnegative().max(1_000_000).optional(),
    outboxRejected: z.number().int().nonnegative().max(1_000_000).optional(),
    network: z.enum(["wifi", "cellular", "ethernet", "none", "unknown"]).optional(),
    // No validamos la forma de la IP: es la IP privada que el terminal ve de
    // sí mismo y sólo sirve para que un humano la lea antes de un `adb
    // connect`. Acotamos el tamaño y ya.
    localIp: z.string().max(60).optional(),
    deviceTime: z.string().datetime().optional(),
    bootedAt: z.string().datetime().optional(),
  })
  .strict();

export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

/**
 * Desvío del reloj del terminal contra el del servidor, en segundos enteros.
 * Positivo = el terminal va adelantado. Null si el terminal no lo dijo.
 *
 * Se acota a ±100 años en segundos para que un `deviceTime` absurdo (reloj a
 * 1970 tras quedarse sin batería, que es un caso real en estos terminales) no
 * desborde el INTEGER de la columna.
 */
const MAX_SKEW_SECONDS = 100 * 365 * 24 * 3600;

export function computeClockSkewSeconds(
  deviceTime: string | undefined,
  serverNow: Date,
): number | null {
  if (!deviceTime) return null;
  const parsed = Date.parse(deviceTime);
  if (Number.isNaN(parsed)) return null;
  const skew = Math.round((parsed - serverNow.getTime()) / 1000);
  if (skew > MAX_SKEW_SECONDS) return MAX_SKEW_SECONDS;
  if (skew < -MAX_SKEW_SECONDS) return -MAX_SKEW_SECONDS;
  return skew;
}

/**
 * Desde cuándo la cola de este terminal no está vacía.
 *
 *   cola vacía            → null (se olvida lo anterior: ya subió todo).
 *   cola > 0 y ya había   → se conserva el instante anterior.
 *   cola > 0 y no había   → ahora.
 *
 * Con esto el panel contesta «lleva 3 h sin subir nada» sin guardar un
 * histórico de latidos que nadie iba a leer.
 */
export function nextOutboxStuckSince(
  pending: number,
  previous: Date | null,
  serverNow: Date,
): Date | null {
  if (pending <= 0) return null;
  return previous ?? serverNow;
}

export interface RecordHeartbeatParams {
  prisma: PrismaClient | Prisma.TransactionClient;
  deviceId: string;
  status: DeviceStatus;
  /** Hora del servidor. Parámetro para poder fijarla en los tests. */
  now?: Date;
}

/**
 * Persiste la instantánea y toca `Device.lastSeenAt`.
 *
 * Un fallo aquí NO puede tumbar el canal: quien llama decide qué hacer, pero
 * el contrato es que el terminal siga vendiendo pase lo que pase. La escritura
 * es un `upsert` sobre la PK, así que dos latidos solapados no chocan.
 */
export async function recordHeartbeat(
  params: RecordHeartbeatParams,
): Promise<void> {
  const { prisma, deviceId, status } = params;
  const now = params.now ?? new Date();

  const previous = await prisma.deviceHeartbeat.findUnique({
    where: { deviceId },
    select: { outboxStuckSince: true },
  });

  const pending = status.outboxPending ?? 0;
  const stuckSince = nextOutboxStuckSince(
    pending,
    previous?.outboxStuckSince ?? null,
    now,
  );

  const data = {
    reportedAt: now,
    bundleBuildHash: status.bundleBuildHash ?? null,
    bundleTarget: status.bundleTarget ?? null,
    platform: status.platform ?? null,
    appVersionName: status.appVersionName ?? null,
    appVersionCode: status.appVersionCode ?? null,
    shiftOpen: status.shiftOpen ?? false,
    shiftOpenedAt: status.shiftOpenedAt ? new Date(status.shiftOpenedAt) : null,
    outboxPending: pending,
    outboxRejected: status.outboxRejected ?? 0,
    outboxStuckSince: stuckSince,
    network: status.network ?? null,
    localIp: status.localIp ?? null,
    deviceTime: status.deviceTime ? new Date(status.deviceTime) : null,
    clockSkewSeconds: computeClockSkewSeconds(status.deviceTime, now),
    bootedAt: status.bootedAt ? new Date(status.bootedAt) : null,
  };

  await prisma.deviceHeartbeat.upsert({
    where: { deviceId },
    create: { deviceId, ...data },
    update: data,
  });

  // `lastSeenAt` ya existía y lo escribe también `/devices/me`. El canal es
  // otra prueba de vida igual de buena, y la más frecuente con diferencia.
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: now },
  });
}
