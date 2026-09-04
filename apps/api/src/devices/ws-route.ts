// A5 · el canal de soporte del terminal.
//
//   GET /ws/device
//
// WebSocket **saliente**: lo abre el terminal contra la API. Es lo que hace
// que funcione detrás del router de cualquier cliente y detrás de un 4G con
// CGNAT, sin abrir un puerto en ningún sitio y sin depender de nadie.
//
// ── Por qué NO se reutiliza /ws/store/:storeId ────────────────────────────
// Aquel canal es del cajero (JWT cashier-session, un store con N suscriptores,
// eventos de mesa). Éste es del terminal (device token, un socket por device,
// estado y soporte). Comparten forma y no comparten nada más: mezclarlos
// obligaría a que el bus de mesas supiera de comandos y a que la revocación de
// un device tocara la mensajería de sala. Se imita el patrón, no se reutiliza.
//
// ── Por qué el token NO viaja en la query string ──────────────────────────
// `/ws/store` pasa el JWT por `?token=` y lo asume consciente: es de TTL corto.
// El device token NO CADUCA NUNCA. En la URL acabaría en los logs de acceso de
// Caddy, en los de cualquier proxy intermedio y en el `request.log` de Fastify,
// donde no se puede redactar lo que no es una cabecera. Así que el socket se
// abre SIN autenticar y el primer mensaje es un `hello` con el token; si no
// llega en HELLO_TIMEOUT_MS, se cierra. El token no se escribe en ningún log
// ni se persiste en ningún sitio: sólo se hashea para el lookup.
//
// Divergencia deliberada respecto a /ws/store — ver ADR-014.
//
// ── Protocolo ─────────────────────────────────────────────────────────────
//   terminal → { "type": "hello", "token": "...", "status": {...}? }
//   servidor → { "type": "ready", "serverTime": "...", "heartbeatIntervalMs": 30000 }
//   terminal → { "type": "status", ... }        cada heartbeatIntervalMs
//   terminal → { "type": "ping" }  →  { "type": "pong", "serverTime": "..." }
//
// Nada de lo que llega por aquí toca cobro, turno, arqueo ni cierre del día.
// El canal es de sólo-mirar; los comandos (que tampoco tocan dinero) viven en
// `commands.ts`.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { hashDeviceToken } from "./auth.js";
import {
  getDeviceChannelRegistry,
  WS_CLOSE,
  type DeviceChannel,
} from "./channel-registry.js";
import {
  DeviceStatusSchema,
  HEARTBEAT_INTERVAL_MS,
  recordHeartbeat,
} from "./heartbeat.js";

/** Margen para que llegue el `hello`. Es un handshake, no una operación. */
export const HELLO_TIMEOUT_MS = 5_000;

/**
 * Tope de tamaño de un mensaje entrante. El canal transporta JSON de estado y
 * resultados de comandos acotados; cualquier cosa mayor es un error o un
 * intento de llenarnos la memoria. Los volcados grandes (logs, capturas) se
 * suben por HTTP con su propio límite, no por aquí.
 */
export const MAX_MESSAGE_BYTES = 512 * 1024;

interface HelloMessage {
  type: "hello";
  token: string;
  status?: unknown;
}

function parseMessage(raw: Buffer): Record<string, unknown> | null {
  if (raw.byteLength > MAX_MESSAGE_BYTES) return null;
  try {
    const data: unknown = JSON.parse(raw.toString("utf8"));
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return null;
    }
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isHello(msg: Record<string, unknown>): msg is HelloMessage &
  Record<string, unknown> {
  return msg.type === "hello" && typeof msg.token === "string";
}

export interface DeviceWebSocketOptions {
  /**
   * Margen para el `hello`. Parámetro sólo para poder probarlo: un test que
   * verifique el cierre por silencio no puede esperarse cinco segundos reales,
   * y falsear los timers rompe el socket de verdad que hay debajo. En
   * producción nadie pasa este valor.
   */
  helloTimeoutMs?: number;
}

export async function registerDeviceWebSocketRoute(
  app: FastifyInstance,
  options: DeviceWebSocketOptions = {},
): Promise<void> {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  app.get("/ws/device", { websocket: true }, async (socket, request) => {
    const registry = getDeviceChannelRegistry();
    let channel: DeviceChannel | null = null;
    let unregister: (() => void) | null = null;

    // Mientras no haya `hello` válido, el socket no es de nadie. Se cierra
    // solo: un socket anónimo abierto indefinidamente es memoria gratis para
    // quien quiera abrir mil.
    let helloTimer: NodeJS.Timeout | null = setTimeout(() => {
      helloTimer = null;
      closeWith(WS_CLOSE.UNAUTHORIZED, "hello timeout");
    }, helloTimeoutMs);

    function clearHelloTimer(): void {
      if (helloTimer) {
        clearTimeout(helloTimer);
        helloTimer = null;
      }
    }

    function closeWith(code: number, reason: string): void {
      clearHelloTimer();
      try {
        socket.close(code, reason);
      } catch {
        // Cerrar dos veces (timeout y error de red a la vez) no es un fallo.
      }
    }

    function send(payload: unknown): boolean {
      if (socket.readyState !== socket.OPEN) return false;
      try {
        socket.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }

    async function handleHello(msg: HelloMessage): Promise<void> {
      const token = msg.token;
      // Un JWT (tres segmentos) es una cashier-session o el test-cashier de la
      // consola, no un terminal. `requireDeviceToken` los acepta en HTTP para
      // que el super-admin pueda operar el TPV sin device emparejado; aquí no:
      // el inventario de terminales tiene que ser terminales de verdad, y un
      // "Probar TPV" abierto en una pestaña no es uno.
      if (token.length < 16 || token.split(".").length === 3) {
        closeWith(WS_CLOSE.UNAUTHORIZED, "invalid token");
        return;
      }

      const prisma = getPrisma();
      const device = await prisma.device.findUnique({
        where: { deviceTokenHash: hashDeviceToken(token) },
        select: { id: true, tenantId: true, registerId: true, revokedAt: true },
      });
      if (!device) {
        closeWith(WS_CLOSE.UNAUTHORIZED, "invalid token");
        return;
      }
      if (device.revokedAt) {
        closeWith(WS_CLOSE.REVOKED, "device revoked");
        return;
      }

      clearHelloTimer();
      channel = {
        deviceId: device.id,
        tenantId: device.tenantId,
        registerId: device.registerId,
        connectedAt: new Date(),
        send,
        close: closeWith,
      };
      unregister = registry.register(channel);

      // El terminal necesita saber cada cuánto hablar y qué hora es aquí: con
      // esas dos cosas puede calcular su propio desvío sin que le mandemos un
      // comando para preguntárselo.
      send({
        type: "ready",
        serverTime: new Date().toISOString(),
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      });

      request.log.info(
        { deviceId: device.id, tenantId: device.tenantId },
        "A5 canal de soporte abierto",
      );

      if (msg.status !== undefined) {
        await handleStatus(msg.status);
      }
    }

    async function handleStatus(rawStatus: unknown): Promise<void> {
      if (!channel) return;
      const parsed = DeviceStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        // Un estado mal formado no tira el canal: preferimos un terminal
        // visible con datos viejos a un terminal invisible. Se registra para
        // que se vea si una versión nueva empieza a mandar basura.
        request.log.warn(
          { deviceId: channel.deviceId, issues: parsed.error.issues.length },
          "A5 heartbeat descartado por schema",
        );
        return;
      }
      const prisma = getPrisma();
      // Red de seguridad: el cierre en caliente lo dispara la revocación
      // (devices/routes.ts), pero si algún día se revoca desde otro proceso
      // —el worker, una consulta a mano en el VPS— el canal se enteraría aquí,
      // al siguiente latido, en vez de seguir vivo para siempre.
      const fresh = await prisma.device.findUnique({
        where: { id: channel.deviceId },
        select: { revokedAt: true },
      });
      if (!fresh || fresh.revokedAt) {
        closeWith(WS_CLOSE.REVOKED, "device revoked");
        return;
      }
      await recordHeartbeat({
        prisma,
        deviceId: channel.deviceId,
        status: parsed.data,
      });
    }

    socket.on("message", (raw: Buffer) => {
      void (async () => {
        const msg = parseMessage(raw);
        if (!msg) return;

        if (!channel) {
          if (!isHello(msg)) return;
          await handleHello(msg);
          return;
        }

        switch (msg.type) {
          case "status": {
            // El `type` es del sobre, no del estado: el schema es `.strict()`
            // y lo rechazaría. Se quita aquí y no se relaja el schema, que es
            // lo que impide que un campo con una errata se guarde en silencio.
            const { type: _type, ...status } = msg;
            await handleStatus(status);
            break;
          }
          case "ping":
            send({ type: "pong", serverTime: new Date().toISOString() });
            break;
          default:
            // Mensaje desconocido: se ignora. El canal es nuestro por los dos
            // lados, así que esto sólo pasa con versiones desparejadas.
            break;
        }
      })().catch((err: unknown) => {
        // Nada de lo que pase en el canal de soporte puede tumbar el proceso
        // que además cobra.
        request.log.error(
          { err, deviceId: channel?.deviceId },
          "A5 fallo procesando mensaje del canal",
        );
      });
    });

    socket.on("close", () => {
      clearHelloTimer();
      unregister?.();
    });

    socket.on("error", (err: Error) => {
      request.log.warn({ err, deviceId: channel?.deviceId }, "A5 error de socket");
      clearHelloTimer();
      unregister?.();
    });
  });
}
