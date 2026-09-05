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
//
// ── R1 · este canal NO PUEDE DESVINCULAR NADA ─────────────────────────────
// Un terminal desvinculado pide un código de 6 dígitos en la barra un lunes por
// la mañana. Así que:
//
//   - Sólo se cierra con `REVOKED` (4403) cuando el device tiene `revokedAt`
//     puesto EN BD. Es el único código ante el que el terminal deja de
//     reintentar, y no se reutiliza para nada más.
//   - Un token que no encaja cierra con `UNAUTHORIZED` (4401) y el terminal
//     sigue reintentando con backoff: no borra su vinculación, no la toca.
//   - Cualquier fallo nuestro —la BD no contesta, una excepción inesperada—
//     cierra con `TRANSIENT` (4500). Un problema de la API jamás puede
//     disfrazarse de "este terminal ya no vale".
//
// Y del lado del terminal, `lib/supportChannel` no importa `unpair`,
// `clearAllDeviceState` ni nada de `useDeviceBootstrap`: el canal no comparte
// camino con el arranque.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { hashDeviceToken } from "./auth.js";
import {
  getDeviceChannelRegistry,
  WS_CLOSE,
  type DeviceChannel,
} from "./channel-registry.js";
import { resolverComando } from "./commands.js";
import {
  DeviceStatusSchema,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  recordHeartbeat,
} from "./heartbeat.js";

/** Margen para que llegue el `hello`. Es un handshake, no una operación. */
export const HELLO_TIMEOUT_MS = 5_000;

/**
 * Tope de tamaño de un mensaje entrante.
 *
 * El mensaje más grande que existe es el resultado de `captura-de-pantalla`: un
 * PNG de 1280×800 de una UI plana ronda los 200 KB, y en base64 unos 270 KB.
 * 2 MiB deja margen de sobra y sigue acotando la memoria — quince terminales no
 * pueden sumar más que eso a la vez.
 */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

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

/**
 * Cada cuánto se comprueba si un canal lleva callado demasiado.
 *
 * Hace falta porque un socket TCP no se entera de que al terminal le han
 * quitado la WiFi o el enchufe: el sistema no manda ningún FIN y la conexión se
 * queda abierta en el servidor hasta que expira el keepalive del kernel, que
 * son minutos. Verificado en el AP11 el 2026-09-04: tras apagarle la WiFi, el
 * panel seguía pintándolo online.
 *
 * Un panel que dice «online» de un terminal apagado es peor que no tener panel:
 * es exactamente el viaje a ciegas que este bloque quiere evitar. Así que si un
 * canal no dice nada en dos latidos y medio, se cierra y desaparece de la lista.
 */
export const LIVENESS_CHECK_MS = 10_000;

export interface DeviceWebSocketOptions {
  /**
   * Margen para el `hello`. Parámetro sólo para poder probarlo: un test que
   * verifique el cierre por silencio no puede esperarse cinco segundos reales,
   * y falsear los timers rompe el socket de verdad que hay debajo. En
   * producción nadie pasa este valor.
   */
  helloTimeoutMs?: number;
  /** Ídem para el silencio del canal. */
  livenessCheckMs?: number;
  silenceTimeoutMs?: number;
}

export async function registerDeviceWebSocketRoute(
  app: FastifyInstance,
  options: DeviceWebSocketOptions = {},
): Promise<void> {
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const livenessCheckMs = options.livenessCheckMs ?? LIVENESS_CHECK_MS;
  const silenceTimeoutMs = options.silenceTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  app.get("/ws/device", { websocket: true }, async (socket, request) => {
    const registry = getDeviceChannelRegistry();
    let channel: DeviceChannel | null = null;
    let unregister: (() => void) | null = null;
    let livenessTimer: NodeJS.Timeout | null = null;
    let lastMessageAt = Date.now();

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

    function clearLivenessTimer(): void {
      if (livenessTimer) {
        clearInterval(livenessTimer);
        livenessTimer = null;
      }
    }

    /**
     * Vigila el silencio del canal. No manda pings: el terminal ya habla solo
     * cada 30 s, así que basta con mirar cuándo fue la última vez. Un ping
     * añadiría tráfico contra quince terminales para saber lo mismo.
     */
    function startLivenessWatch(): void {
      clearLivenessTimer();
      livenessTimer = setInterval(() => {
        if (Date.now() - lastMessageAt <= silenceTimeoutMs) return;
        request.log.info(
          { deviceId: channel?.deviceId },
          "A5 canal callado demasiado tiempo: se cierra",
        );
        // R1: esto NO es una revocación. Es "has dejado de hablar". El terminal
        // ni se entera (su socket ya estaba muerto) y, cuando vuelva la red,
        // reconecta con su backoff.
        closeWith(WS_CLOSE.TRANSIENT, "silence");
      }, livenessCheckMs);
      livenessTimer.unref?.();
    }

    function closeWith(code: number, reason: string): void {
      clearHelloTimer();
      clearLivenessTimer();
      // El `close` del socket puede tardar (o no llegar nunca si el terminal ya
      // no está): se da de baja YA, para que el panel deje de pintarlo online
      // en el mismo instante en que se decide que no está.
      unregister?.();
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
      let device: {
        id: string;
        tenantId: string;
        registerId: string;
        revokedAt: Date | null;
      } | null;
      try {
        device = await prisma.device.findUnique({
          where: { deviceTokenHash: hashDeviceToken(token) },
          select: { id: true, tenantId: true, registerId: true, revokedAt: true },
        });
      } catch (err) {
        // R1: la BD no contesta. Es un problema NUESTRO y se cierra como tal;
        // decirle "revocado" a un terminal sano lo dejaría sin canal hasta que
        // alguien fuese al local.
        request.log.error({ err }, "A5 hello: la BD no contestó");
        closeWith(WS_CLOSE.TRANSIENT, "transient");
        return;
      }
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
      lastMessageAt = Date.now();
      startLivenessWatch();

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
      // R1: `REVOKED` sólo si de verdad está revocado en BD. Si la fila ya no
      // existe (borrada a mano, tenant eliminado) es "no te conozco", no "te
      // hemos revocado", y el terminal reintenta en vez de rendirse.
      if (!fresh) {
        closeWith(WS_CLOSE.UNAUTHORIZED, "unknown device");
        return;
      }
      if (fresh.revokedAt) {
        closeWith(WS_CLOSE.REVOKED, "device revoked");
        return;
      }
      // R2: lo ÚNICO que este bloque escribe en `Device` es `lastSeenAt`, más
      // su instantánea en `DeviceHeartbeat`. Ni el token, ni `revokedAt`, ni
      // nada del emparejamiento.
      await recordHeartbeat({
        prisma,
        deviceId: channel.deviceId,
        status: parsed.data,
      });
    }

    socket.on("message", (raw: Buffer) => {
      lastMessageAt = Date.now();
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
          case "command-result": {
            // El resultado se encaja con el comando que lo espera. El
            // `deviceId` sale del canal, no del mensaje: un terminal no puede
            // contestar por otro ni por un error de versión.
            if (typeof msg.commandId !== "string") break;
            resolverComando(
              channel.deviceId,
              msg.commandId,
              msg.ok === true
                ? { estado: "ok", datos: msg.data ?? null }
                : {
                    estado: "error",
                    mensaje:
                      typeof msg.error === "string"
                        ? msg.error.slice(0, 500)
                        : "el terminal no dijo por qué falló",
                  },
            );
            break;
          }
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
      clearLivenessTimer();
      unregister?.();
    });

    socket.on("error", (err: Error) => {
      request.log.warn({ err, deviceId: channel?.deviceId }, "A5 error de socket");
      clearHelloTimer();
      clearLivenessTimer();
      unregister?.();
    });
  });
}
