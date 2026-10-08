// kds-1-cocina · EL SOCKET DE LA PANTALLA.
//
//   GET /ws/kitchen
//
// ── Por qué no se reutiliza /ws/store/:storeId ────────────────────────
//
// Aquél pasa el JWT de cajero por `?token=` y lo asume consciente porque es
// de TTL corto. La pantalla de cocina **no tiene JWT de cajero**: no hace
// login, no abre turno y no teclea PIN (está colgada de una pared y el
// cocinero tiene las manos ocupadas). Su identidad es el **device token**,
// que NO CADUCA NUNCA: en una URL acabaría en los logs de acceso de Caddy,
// en los de cualquier proxy y en el `request.log` de Fastify, donde no se
// puede redactar lo que no es una cabecera.
//
// Así que se imita `/ws/device` de A5: el socket se abre SIN autenticar y
// el primer mensaje es un `hello` con el token. Si no llega en
// HELLO_TIMEOUT_MS, se cierra.
//
// ── Protocolo ─────────────────────────────────────────────────────────
//   pantalla → { "type": "hello", "token": "..." }
//   servidor → { "type": "ready", "serverTime": "...", "sections": [...] }
//   servidor → cada WsEvent de cocina de SU tienda
//   pantalla → { "type": "ping" }  →  { "type": "pong", "serverTime": "..." }
//
// ── Esto NO desvincula nada ───────────────────────────────────────────
//
// Misma regla que R1 de A5, y por la misma razón: una pantalla
// desvinculada pide un código de 6 dígitos colgada de la pared de una
// cocina un sábado a las dos. Sólo se cierra con 4403 cuando el
// dispositivo está revocado EN BD; un token que no encaja cierra con 4401
// y la pantalla sigue reintentando sin tocar su vinculación.
//
// ── La verdad sigue estando en el GET ─────────────────────────────────
//
// Lo que llega por aquí son avisos. La pantalla pide
// `GET /kitchen/comandas` al conectar, al reconectar y cada vez que un
// aviso le dice que algo cambió. Un socket caído no pierde comandas: las
// retrasa hasta el siguiente GET, y mientras tanto la pantalla se pone
// entera en rojo (decisión 9).

import type { FastifyInstance } from "fastify";

import { getStoreEventBus } from "../realtime/store-event-bus.js";
import type { WsEvent } from "../realtime/store-events.js";
import { resolverPantalla } from "./auth.js";

export const HELLO_TIMEOUT_MS = 5_000;

export const WS_KITCHEN_CLOSE = {
  UNAUTHORIZED: 4401,
  REVOKED: 4403,
  MODULE_OFF: 4404,
  TRANSIENT: 4500,
} as const;

/** Los tipos de evento que una pantalla de cocina tiene que ver. */
const DE_COCINA = new Set<WsEvent["type"]>([
  "kitchen.order_created",
  "kitchen.line_voided",
  "kitchen.course_fired",
  "kitchen.order_urgent",
  "kitchen.line_done",
  "kitchen.order_ready",
  "kitchen.order_served",
]);

export async function registerKitchenWebSocketRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get("/ws/kitchen", { websocket: true }, async (socket, request) => {
    let unsubscribe: (() => void) | null = null;
    let autenticada = false;

    const hello = setTimeout(() => {
      if (!autenticada && socket.readyState === socket.OPEN) {
        socket.close(WS_KITCHEN_CLOSE.UNAUTHORIZED, "no hello");
      }
    }, HELLO_TIMEOUT_MS);

    socket.on("message", async (raw: Buffer) => {
      let data: { type?: string; token?: string };
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (data.type === "ping") {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({ type: "pong", serverTime: new Date().toISOString() }),
          );
        }
        return;
      }
      if (data.type !== "hello" || autenticada) return;
      const token = typeof data.token === "string" ? data.token : "";
      if (token.length < 16) {
        socket.close(WS_KITCHEN_CLOSE.UNAUTHORIZED, "bad token");
        return;
      }
      let res: Awaited<ReturnType<typeof resolverPantalla>>;
      try {
        res = await resolverPantalla(token);
      } catch (err) {
        // Un problema nuestro jamás puede disfrazarse de «esta pantalla ya
        // no vale». Cierra TRANSIENT y la pantalla reintenta.
        request.log.error({ err }, "ws/kitchen · fallo resolviendo la pantalla");
        socket.close(WS_KITCHEN_CLOSE.TRANSIENT, "transient");
        return;
      }
      if ("error" in res) {
        socket.close(
          res.error === "REVOKED"
            ? WS_KITCHEN_CLOSE.REVOKED
            : res.error === "MODULE_OFF"
              ? WS_KITCHEN_CLOSE.MODULE_OFF
              : WS_KITCHEN_CLOSE.UNAUTHORIZED,
          res.error,
        );
        return;
      }
      autenticada = true;
      clearTimeout(hello);
      const sections = new Set(res.sections);
      unsubscribe = getStoreEventBus().subscribe(res.storeId, {
        send(event: WsEvent) {
          if (!DE_COCINA.has(event.type)) return;
          // Una pantalla sólo ve lo de SUS secciones. Los eventos que no
          // llevan sección (`line_voided`, `course_fired`) pasan: son un
          // «mira otra vez», y el GET que la pantalla pide a continuación
          // ya está filtrado por sección. Dejarlos pasar cuesta un GET;
          // filtrarlos mal cuesta un anulado que nadie ve.
          if ("section" in event && !sections.has(event.section)) return;
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        },
      });
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "ready",
            serverTime: new Date().toISOString(),
            sections: res.sections,
          }),
        );
      }
    });

    socket.on("close", () => {
      clearTimeout(hello);
      unsubscribe?.();
    });
    socket.on("error", (err: Error) => {
      request.log.warn({ err }, "ws/kitchen · socket con error");
      clearTimeout(hello);
      unsubscribe?.();
    });
  });
}
