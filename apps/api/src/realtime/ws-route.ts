// Endpoint WebSocket multi-terminal (B7 §6).
//
//   GET /ws/store/:storeId?token=<cashier-session-jwt>
//
// El cliente PWA abre la conexión tras login. Se autentica con el JWT
// cashier-session (mismo que `Authorization: Bearer ...` en HTTP)
// pasado por query string, porque el WebSocket nativo del browser no
// permite cabeceras personalizadas. El token es de TTL corto (B3) y se
// pasa también por la URL — lo redactamos en logs (server.ts ya
// redacta `req.headers.authorization`; el query queda visible, lo
// asumimos consciente).
//
// Después de validar el JWT y comprobar que el `storeId` solicitado
// coincide con el register del cashier (no puede suscribirse al
// store ajeno), el socket se registra en el bus en memoria. Cada
// evento `WsEvent` se envía como JSON. El cliente puede mandar
// `{ "type": "ping" }` para keep-alive — responde `pong`.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { verifyCashierSession } from "../shift/cashier-session.js";
import { getStoreEventBus } from "./store-event-bus.js";
import type { WsEvent } from "./store-events.js";

export async function registerStoreWebSocketRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { token?: string };
  }>(
    "/ws/store/:storeId",
    { websocket: true },
    async (socket, request) => {
      const { storeId } = request.params;
      const token = request.query.token;
      if (!token) {
        socket.close(4401, "missing token");
        return;
      }
      let payload;
      try {
        payload = verifyCashierSession(token);
      } catch {
        socket.close(4401, "invalid token");
        return;
      }
      const prisma = getPrisma();
      const register = await prisma.register.findFirst({
        where: { id: payload.rid, storeId, deletedAt: null },
        select: { id: true, storeId: true },
      });
      if (!register) {
        // El cashier intentó suscribirse a un store distinto al de su
        // register o el register ha sido borrado entre login y WS.
        socket.close(4403, "store mismatch");
        return;
      }

      const bus = getStoreEventBus();
      const unsubscribe = bus.subscribe(storeId, {
        send(event: WsEvent) {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        },
      });

      socket.on("message", (raw: Buffer) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data && data.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // Ignoramos mensajes que no parseen — el cliente no debería
          // mandar nada distinto de `{type:"ping"}`.
        }
      });

      socket.on("close", () => {
        unsubscribe();
      });
      socket.on("error", (err: Error) => {
        request.log.warn(
          { err, storeId },
          "ws socket error — desuscribiendo",
        );
        unsubscribe();
      });
    },
  );
}
