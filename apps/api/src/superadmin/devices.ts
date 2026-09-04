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
import { ComandoRechazado, enviarComando } from "../devices/commands.js";
import {
  CapturaInvalida,
  abrirCaptura,
  decodificarCaptura,
  guardarCaptura,
  SCREENSHOT_MIME,
} from "../devices/screenshots.js";
import { extractRequestSignals, writeAudit } from "./audit.js";
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

// ── Comandos ───────────────────────────────────────────────────────────────

const COMANDO_BODY_SCHEMA = {
  type: "object",
  required: ["action", "reason"],
  additionalProperties: false,
  properties: {
    // A propósito NO es un `enum`. Si la lista blanca viviera en el schema,
    // Ajv devolvería un 400 antes de llegar al handler y un comando fuera de
    // la lista NO quedaría auditado — y el intento es justo lo que hay que
    // poder ver después. La lista la aplica `enviarComando`, que audita el
    // rechazo antes de negarse.
    action: { type: "string", minLength: 1, maxLength: 60 },
    // El motivo es obligatorio. Un comando sin motivo no se puede revisar seis
    // meses después, que es cuando se revisa.
    reason: { type: "string", minLength: 3, maxLength: 300 },
  },
} as const;

const DEVICE_PARAMS_SCHEMA = {
  type: "object",
  required: ["deviceId"],
  properties: { deviceId: { type: "string", format: "uuid" } },
} as const;

export async function registerSuperAdminDeviceCommandRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/super-admin/devices/:deviceId/commands",
    {
      preHandler: requireSuperAdmin,
      schema: { params: DEVICE_PARAMS_SCHEMA, body: COMANDO_BODY_SCHEMA },
    },
    async (request, reply) => {
      const { deviceId } = request.params as { deviceId: string };
      const { action, reason } = request.body as { action: string; reason: string };
      const superAdminId = request.superAdmin!.superAdminId;
      const prisma = getPrisma();

      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, tenantId: true, revokedAt: true },
      });
      if (!device) {
        return reply
          .code(404)
          .send({ error: "DEVICE_NOT_FOUND", message: "Terminal no encontrado" });
      }
      if (device.revokedAt) {
        // Un terminal revocado no tiene canal, pero se contesta con su propio
        // error en vez de con "offline": son dos situaciones distintas y el
        // panel no debe invitar a reintentar.
        return reply.code(409).send({
          error: "DEVICE_REVOKED",
          message: "Ese terminal está revocado.",
        });
      }

      try {
        const enviado = await enviarComando({
          prisma,
          superAdminId,
          deviceId,
          tenantId: device.tenantId,
          accion: action,
          motivo: reason,
          signals: extractRequestSignals(request as never),
        });
        // La captura no se devuelve en el cuerpo de la respuesta: se guarda y
        // se devuelve su id. Así la imagen tiene dueño, motivo y caducidad
        // desde el primer segundo, en vez de quedarse suelta en una respuesta
        // HTTP que nadie sabe dónde acaba.
        if (
          enviado.accion === "captura-de-pantalla" &&
          enviado.resultado.estado === "ok"
        ) {
          try {
            const png = decodificarCaptura(enviado.resultado.datos);
            const guardada = await guardarCaptura({
              prisma,
              deviceId,
              tenantId: device.tenantId,
              superAdminId,
              commandId: enviado.commandId,
              motivo: reason,
              png,
            });
            await writeAudit({
              prisma,
              superAdminId,
              action: "device_screenshot",
              tenantId: device.tenantId,
              metadata: {
                ...extractRequestSignals(request as never),
                deviceId,
                commandId: enviado.commandId,
                screenshotId: guardada.screenshotId,
                motivo: reason,
                bytes: guardada.bytes,
                expiresAt: guardada.expiresAt.toISOString(),
              },
            });
            return reply.code(200).send({
              commandId: enviado.commandId,
              action: enviado.accion,
              status: "ok",
              data: {
                screenshotId: guardada.screenshotId,
                bytes: guardada.bytes,
                expiresAt: guardada.expiresAt.toISOString(),
              },
              error: null,
            });
          } catch (err) {
            if (err instanceof CapturaInvalida) {
              return reply.code(200).send({
                commandId: enviado.commandId,
                action: enviado.accion,
                status: "error",
                data: null,
                error: err.message,
              });
            }
            throw err;
          }
        }

        return reply.code(200).send({
          commandId: enviado.commandId,
          action: enviado.accion,
          // "sin-respuesta" es un resultado, no un error: el panel tiene que
          // poder pintar "no volvió" en vez de quedarse en "enviando".
          status: enviado.resultado.estado,
          data:
            enviado.resultado.estado === "ok" ? enviado.resultado.datos : null,
          error:
            enviado.resultado.estado === "error"
              ? enviado.resultado.mensaje
              : null,
        });
      } catch (err) {
        if (err instanceof ComandoRechazado) {
          return reply
            .code(err.status)
            .send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
}

// ── Capturas guardadas ─────────────────────────────────────────────────────

const SCREENSHOT_PARAMS_SCHEMA = {
  type: "object",
  required: ["screenshotId"],
  properties: { screenshotId: { type: "string", format: "uuid" } },
} as const;

export async function registerSuperAdminScreenshotRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Listado de las capturas VIVAS de un terminal. Las caducadas no se listan
  // aunque el barrido todavía no haya pasado: la retención es una promesa
  // sobre el acceso, no sobre el cron.
  app.get(
    "/super-admin/devices/:deviceId/screenshots",
    { preHandler: requireSuperAdmin, schema: { params: DEVICE_PARAMS_SCHEMA } },
    async (request) => {
      const { deviceId } = request.params as { deviceId: string };
      const prisma = getPrisma();
      const capturas = await prisma.deviceScreenshot.findMany({
        where: { deviceId, expiresAt: { gt: new Date() } },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          bytes: true,
          reason: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return {
        screenshots: capturas.map((c) => ({
          id: c.id,
          createdAt: c.createdAt.toISOString(),
          expiresAt: c.expiresAt.toISOString(),
          bytes: c.bytes,
          reason: c.reason,
        })),
      };
    },
  );

  // El binario. Cada apertura se audita: mirar la foto es un acceso nuevo a
  // los datos de ese cliente, distinto de haberla pedido.
  app.get(
    "/super-admin/devices/screenshots/:screenshotId",
    { preHandler: requireSuperAdmin, schema: { params: SCREENSHOT_PARAMS_SCHEMA } },
    async (request, reply) => {
      const { screenshotId } = request.params as { screenshotId: string };
      const prisma = getPrisma();
      const captura = await prisma.deviceScreenshot.findUnique({
        where: { id: screenshotId },
        select: {
          id: true,
          deviceId: true,
          tenantId: true,
          fileName: true,
          expiresAt: true,
        },
      });
      if (!captura) {
        return reply.code(404).send({
          error: "SCREENSHOT_NOT_FOUND",
          message: "Esa captura ya no existe.",
        });
      }
      const abierta = await abrirCaptura(captura.fileName, captura.expiresAt);
      if (!abierta) {
        // Caducada, o el fichero ya no está. Mismo mensaje a propósito: para
        // quien mira son la misma cosa, y no hace falta contarle al navegador
        // en qué estado interno se quedó el barrido.
        return reply.code(404).send({
          error: "SCREENSHOT_EXPIRED",
          message: "Esa captura ya ha caducado.",
        });
      }

      await writeAudit({
        prisma,
        superAdminId: request.superAdmin!.superAdminId,
        action: "device_screenshot_viewed",
        tenantId: captura.tenantId,
        metadata: {
          ...extractRequestSignals(request as never),
          deviceId: captura.deviceId,
          screenshotId: captura.id,
        },
      });

      return reply
        .header("Content-Type", SCREENSHOT_MIME)
        .header("Content-Length", abierta.bytes)
        // Una foto con datos de clientes no se queda en la caché de nadie.
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(abierta.stream);
    },
  );
}
