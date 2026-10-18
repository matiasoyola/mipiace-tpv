// residencia-4 (D-66) · **EL SOCKET DEL MÓVIL DE GUARDIA.**
//
//   GET /ws/guardia
//
// Copia estructural de `/ws/kitchen` (kds-1), y la copia es deliberada:
// es el mismo problema —un aparato emparejado, sin JWT de cajero, cuya
// identidad es el device token— y que se lean igual es lo que hace que el
// día que uno cambie, se vea que el otro no.
//
// ── Por qué el token NO va en la URL ────────────────────────────────
//
// Porque el device token **no caduca nunca**: en un `?token=` acabaría en
// los logs de acceso de Caddy, en los de cualquier proxy y en el
// `request.log` de Fastify, donde no se puede redactar lo que no es una
// cabecera. Así que el socket se abre SIN autenticar y el primer mensaje
// es un `hello` con el token; si no llega en `HELLO_TIMEOUT_MS`, se
// cierra. Es lo mismo que hacen `/ws/device` (A5) y `/ws/kitchen`.
//
// ── Protocolo ───────────────────────────────────────────────────────
//   móvil    → { "type": "hello", "token": "..." }
//   servidor → { "type": "ready", "serverTime": "...", "canal": "..." }
//   servidor → { "type": "aviso" | "acuse" | "cerrada", ... }
//   móvil    → { "type": "ping" }  →  { "type": "pong", "serverTime": … }
//
// ── LO QUE VIAJA POR AQUÍ NO ES DATO DE SALUD ───────────────────────
//
// Y es una decisión, no una casualidad. El evento lleva **el id del
// aviso, el nivel y la hora**: ni el nombre del residente, ni la
// habitación, ni qué le pasa. El detalle se pide con
// `GET /residencia/guardia/avisos`, que va detrás de la sesión y deja su
// línea en el registro de accesos.
//
// La razón es la pantalla bloqueada. Lo que la APK pinta en la
// notificación del sistema sale de este evento, y lo que ahí cabe es
// «Aviso N2 · habitación 112» y nada más (alcance, «nada de salud en la
// notificación»). Si el evento trajera el diagnóstico, la tentación de
// pintarlo estaría a una línea de distancia.
//
// Por eso tampoco va la habitación en el evento: la APK la saca del GET
// que hace nada más despertar, y si no le da tiempo la notificación dice
// «Aviso N2» a secas, que sigue siendo suficiente para sacar el móvil del
// bolsillo.
//
// ── Y ESTO NO DESVINCULA NADA ───────────────────────────────────────
//
// Misma regla que R1 de A5: sólo se cierra con 4403 cuando el
// dispositivo está revocado EN BD. Un token que no encaja cierra con 4401
// y el móvil sigue reintentando sin tocar su emparejamiento. Un móvil de
// guardia que se desempareja solo a las tres de la mañana es un centro
// sin avisos hasta que alguien lo note.

import type { FastifyInstance } from "fastify";

import { getBusDeGuardia, type EventoDeGuardia } from "./guardia-bus.js";
import { resolverGuardia } from "./guardia-auth.js";

export const HELLO_TIMEOUT_MS = 5_000;

export const WS_GUARDIA_CLOSE = {
  UNAUTHORIZED: 4401,
  REVOKED: 4403,
  MODULE_OFF: 4404,
  TRANSIENT: 4500,
} as const;

export async function registerGuardiaWebSocketRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get("/ws/guardia", { websocket: true }, async (socket, request) => {
    let desuscribir: (() => void) | null = null;
    let autenticado = false;

    const hello = setTimeout(() => {
      if (!autenticado && socket.readyState === socket.OPEN) {
        socket.close(WS_GUARDIA_CLOSE.UNAUTHORIZED, "no hello");
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
      if (data.type !== "hello" || autenticado) return;
      const token = typeof data.token === "string" ? data.token : "";
      if (token.length < 16) {
        socket.close(WS_GUARDIA_CLOSE.UNAUTHORIZED, "bad token");
        return;
      }
      let res: Awaited<ReturnType<typeof resolverGuardia>>;
      try {
        res = await resolverGuardia(token);
      } catch (err) {
        // Un problema nuestro jamás puede disfrazarse de «este móvil ya
        // no vale». Cierra TRANSIENT y el móvil reintenta.
        request.log.error({ err }, "ws/guardia · fallo resolviendo el móvil");
        socket.close(WS_GUARDIA_CLOSE.TRANSIENT, "transient");
        return;
      }
      if ("error" in res) {
        socket.close(
          res.error === "REVOKED"
            ? WS_GUARDIA_CLOSE.REVOKED
            : res.error === "MODULE_OFF"
              ? WS_GUARDIA_CLOSE.MODULE_OFF
              : WS_GUARDIA_CLOSE.UNAUTHORIZED,
          res.error,
        );
        return;
      }
      autenticado = true;
      clearTimeout(hello);
      desuscribir = getBusDeGuardia().suscribir(res.tenantId, res.canal, {
        send(evento: EventoDeGuardia) {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(evento));
          }
        },
      });
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "ready",
            serverTime: new Date().toISOString(),
            canal: res.canal,
          }),
        );
      }
    });

    socket.on("close", () => {
      clearTimeout(hello);
      desuscribir?.();
    });
    socket.on("error", (err: Error) => {
      request.log.warn({ err }, "ws/guardia · socket con error");
      clearTimeout(hello);
      desuscribir?.();
    });
  });
}
