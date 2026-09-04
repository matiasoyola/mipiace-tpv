// A5 · el canal de soporte, lado terminal.
//
// Abre un WebSocket saliente contra `/ws/device`, se autentica con el device
// token en el primer mensaje y publica su estado al conectar y cada
// `heartbeatIntervalMs` (lo dice el servidor en el `ready`).
//
// ── La regla que manda sobre todas las demás ──────────────────────────────
// **Esto es irrelevante para el camarero.** Si la API está caída, el TPV vende
// igual: el canal reintenta en segundo plano y nadie se entera. Por eso:
//
//   - No hay estado de React, no hay contexto, no hay hook. Se arranca una vez
//     y devuelve la función de parada.
//   - Ninguna pantalla espera a nada de aquí.
//   - Todo error se traga. Un canal de soporte que rompa una venta es peor que
//     no tener canal.
//
// El token NO va en la URL (acabaría en los logs de Caddy y no caduca nunca):
// va en el primer mensaje. El servidor cierra el socket si no llega en 5 s.

import { getDeviceToken } from "../../storage.js";
import { backoffDelayMs } from "./backoff.js";
import { collectDeviceStatus } from "./status.js";

/** Intervalo por defecto hasta que el servidor diga el suyo en el `ready`. */
const DEFAULT_HEARTBEAT_MS = 30_000;

/** Cotas de lo que aceptamos del servidor, por si un día manda una barbaridad. */
const MIN_HEARTBEAT_MS = 5_000;
const MAX_HEARTBEAT_MS = 10 * 60_000;

/**
 * Código con el que el servidor cierra el canal de un device revocado. No se
 * reintenta: un terminal revocado que insistiera cada minuto sería ruido
 * permanente contra la API y nunca va a volver a valer sin re-emparejar.
 */
const CLOSE_REVOKED = 4403;

function wsBaseUrl(): string {
  const apiUrl = (
    (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env
      ?.VITE_API_URL ?? ""
  ).trim();
  // En la APK `VITE_API_URL` es absoluta (la fija el build de tpv-android), así
  // que el canal va directo al dominio de la API. En la PWA es "/api" o vacía y
  // caemos al origen de la página, que es lo que Caddy proxea con `handle /ws/*`.
  const base =
    apiUrl.startsWith("http") ? apiUrl.replace(/\/$/, "") : window.location.origin;
  return base.replace(/^http/, "ws");
}

export interface SupportChannelHandle {
  stop(): void;
}

/**
 * Arranca el canal. Devuelve el `stop` para el cleanup del efecto.
 *
 * Sin device token no hace nada: un terminal sin vincular no tiene nada que
 * anunciar, y pedirle que abra un socket sólo generaría reintentos eternos.
 */
export function startSupportChannel(): SupportChannelHandle {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    return { stop: () => {} };
  }

  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;

  function clearTimers(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, backoffDelayMs(attempt));
  }

  function send(payload: unknown): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // Socket muerto entre el check y el send. El `close` lo recogerá.
    }
  }

  function startHeartbeat(intervalMs: number): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      void collectDeviceStatus()
        .then((status) => send({ type: "status", ...status }))
        .catch(() => {});
    }, intervalMs);
  }

  function open(): void {
    if (stopped) return;
    const token = getDeviceToken();
    if (!token) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsBaseUrl()}/ws/device`);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.addEventListener("open", () => {
      if (stopped) {
        try {
          ws.close();
        } catch {
          /* ya cerrado */
        }
        return;
      }
      // El `hello` lleva ya la primera instantánea: así el panel ve el estado
      // del terminal en el mismo viaje en que lo ve aparecer, sin esperar al
      // primer latido.
      void collectDeviceStatus()
        .then((status) => send({ type: "hello", token, status }))
        .catch(() => send({ type: "hello", token }));
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: { type?: unknown; heartbeatIntervalMs?: unknown };
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.type !== "ready") return;
      // El canal está autenticado. Sólo AQUÍ se considera bueno el intento:
      // un socket que abre y se cierra a los 5 s por token inválido no debe
      // reiniciar el backoff, o serían reintentos cada segundo para siempre.
      attempt = 0;
      const interval =
        typeof msg.heartbeatIntervalMs === "number" &&
        msg.heartbeatIntervalMs >= MIN_HEARTBEAT_MS &&
        msg.heartbeatIntervalMs <= MAX_HEARTBEAT_MS
          ? msg.heartbeatIntervalMs
          : DEFAULT_HEARTBEAT_MS;
      startHeartbeat(interval);
    });

    ws.addEventListener("close", (ev: CloseEvent) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      socket = null;
      if (stopped) return;
      if (ev.code === CLOSE_REVOKED) return;
      scheduleReconnect();
    });

    // `error` siempre viene seguido de `close`, así que la reconexión se
    // programa allí y aquí no se hace nada. Suscribirse evita el
    // "unhandled error event" en consola.
    ws.addEventListener("error", () => {});
  }

  // Cuando el terminal recupera la red, no esperamos al backoff: puede llevar
  // un minuto de espera acumulado y el `online` es la señal exacta.
  const onOnline = (): void => {
    if (stopped || socket) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    attempt = 0;
    open();
  };
  window.addEventListener("online", onOnline);

  open();

  return {
    stop() {
      stopped = true;
      clearTimers();
      window.removeEventListener("online", onOnline);
      if (socket) {
        try {
          socket.close(1000, "stop");
        } catch {
          /* ya cerrado */
        }
        socket = null;
      }
    },
  };
}
