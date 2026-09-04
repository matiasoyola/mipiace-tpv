// A5 · Frente 2 · el inventario de terminales que ve el super-admin.
//
//   GET /super-admin/devices?tenantId=&storeId=
//
// Contesta las preguntas que hoy no tienen respuesta sin coger el coche: qué
// terminales existen, cuáles están encendidos, qué versión llevan, cuánta cola
// arrastran y quién está desactualizado.
//
// Dos fuentes, y conviene no confundirlas:
//
//   - `DeviceHeartbeat` es lo que el terminal contó la última vez. Sobrevive a
//     un reinicio de la API y puede ser de hace tres días.
//   - El registro de canales en memoria es quién está hablando AHORA. No
//     sobrevive a nada, y así debe ser.
//
// Por eso `online` sale del registro y no de comparar fechas: un terminal cuyo
// último latido es de hace 20 s pero cuyo socket se acaba de caer está offline,
// y el panel tiene que decirlo.
//
// Esta lectura NO se audita. Es la pantalla de inicio del soporte y se
// refresca sola: auditar cada refresco ahogaría el registro y haría invisible
// lo que sí importa —los comandos y las capturas, que sí se auditan uno a uno.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { getDeviceChannelRegistry } from "../devices/channel-registry.js";
import { HEARTBEAT_TIMEOUT_MS } from "../devices/heartbeat.js";
import { readReleases } from "../releases/store.js";
import { requireSuperAdmin } from "./middleware.js";

/**
 * ¿Este terminal lleva una versión vieja?
 *
 * `null` cuando no se puede saber, y hay dos motivos distintos con la misma
 * respuesta: que no haya índice de releases publicado (en dev y en CI está
 * vacío) o que el terminal no haya dicho nunca su versión. En ninguno de los
 * dos casos vale marcarlo en rojo: el panel diría que los quince están
 * desactualizados y nadie volvería a mirar esa columna.
 */
export function isOutdated(
  appVersionCode: number | null,
  latestVersionCode: number | null,
): boolean | null {
  if (latestVersionCode == null || appVersionCode == null) return null;
  return appVersionCode < latestVersionCode;
}

/**
 * ¿El último latido es tan viejo que ya no dice nada?
 *
 * Sirve para el terminal que aparece offline: «visto hace 3 min» es
 * información útil; «visto hace 9 días» dice que ese terminal lleva apagado
 * desde entonces y que lo que cuenta su instantánea es historia.
 */
export function isStale(
  reportedAt: Date | null,
  now: Date,
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): boolean {
  if (!reportedAt) return true;
  return now.getTime() - reportedAt.getTime() > timeoutMs;
}

const LISTA_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenantId: { type: "string", format: "uuid" },
    storeId: { type: "string", format: "uuid" },
    // Por defecto los revocados no se pintan: son ruido permanente en una
    // pantalla que se mira para actuar. Con `incluirRevocados=true` salen.
    incluirRevocados: { type: "boolean", default: false },
  },
} as const;

export async function registerSuperAdminDevicesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/super-admin/devices",
    { preHandler: requireSuperAdmin, schema: { querystring: LISTA_QUERY_SCHEMA } },
    async (request) => {
      const { tenantId, storeId, incluirRevocados } = request.query as {
        tenantId?: string;
        storeId?: string;
        incluirRevocados?: boolean;
      };
      const prisma = getPrisma();
      const now = new Date();

      const devices = await prisma.device.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          ...(storeId ? { register: { storeId } } : {}),
          ...(incluirRevocados ? {} : { revokedAt: null }),
        },
        select: {
          id: true,
          name: true,
          tenantId: true,
          pairedAt: true,
          lastSeenAt: true,
          revokedAt: true,
          tenant: { select: { id: true, name: true } },
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { id: true, name: true } },
            },
          },
          heartbeat: true,
        },
        orderBy: [{ tenantId: "asc" }, { pairedAt: "asc" }],
      });

      // El índice de A3. Si no hay ninguno publicado (dev, CI, o un VPS recién
      // montado) `readReleases` devuelve [] sin lanzar, y la columna
      // "desactualizado" queda en null para todos en vez de en rojo.
      const releases = await readReleases();
      const latest = releases[0] ?? null;

      const registry = getDeviceChannelRegistry();

      return {
        latestRelease: latest
          ? { versionCode: latest.versionCode, versionName: latest.versionName }
          : null,
        devices: devices.map((d) => {
          const hb = d.heartbeat;
          const online = registry.isOnline(d.id);
          return {
            id: d.id,
            // El nombre importa más de lo que parece: dentro de un año habrá
            // quince y hay que poder decir "el de la barra de Sirope", no un
            // UUID. Si el device no tiene nombre propio, el de la caja y la
            // tienda hacen de nombre.
            name: d.name,
            tenantId: d.tenant.id,
            tenantName: d.tenant.name,
            storeId: d.register.store.id,
            storeName: d.register.store.name,
            registerId: d.register.id,
            registerName: d.register.name,
            pairedAt: d.pairedAt.toISOString(),
            lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
            revokedAt: d.revokedAt?.toISOString() ?? null,
            online,
            stale: isStale(hb?.reportedAt ?? null, now),
            outdated: isOutdated(
              hb?.appVersionCode ?? null,
              latest?.versionCode ?? null,
            ),
            heartbeat: hb
              ? {
                  reportedAt: hb.reportedAt.toISOString(),
                  appVersionName: hb.appVersionName,
                  appVersionCode: hb.appVersionCode,
                  bundleBuildHash: hb.bundleBuildHash,
                  bundleTarget: hb.bundleTarget,
                  platform: hb.platform,
                  // A4 en una columna: dentro de la APK ejecutando un bundle
                  // que no salió de la APK. Si vuelve a pasar, se ve el primer
                  // día en vez de en hora y media.
                  foreignBundle:
                    hb.platform === "android" && hb.bundleTarget !== "android",
                  shiftOpen: hb.shiftOpen,
                  shiftOpenedAt: hb.shiftOpenedAt?.toISOString() ?? null,
                  outboxPending: hb.outboxPending,
                  outboxRejected: hb.outboxRejected,
                  outboxStuckSince: hb.outboxStuckSince?.toISOString() ?? null,
                  network: hb.network,
                  localIp: hb.localIp,
                  clockSkewSeconds: hb.clockSkewSeconds,
                  bootedAt: hb.bootedAt?.toISOString() ?? null,
                }
              : null,
          };
        }),
      };
    },
  );
}
