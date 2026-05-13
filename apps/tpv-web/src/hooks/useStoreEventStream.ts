// WebSocket cliente del bus multi-terminal (B7 §6.4).
//
// Recibe el `storeId` del TPV (el endpoint `/tpv/tables` lo devuelve) y
// abre una conexión a `/ws/store/:storeId?token=<cashier-session>`.
// Reconecta en error con backoff fijo de 3 s — suficiente para piloto;
// si en producción aparece flapping podemos cambiar a backoff
// exponencial.
//
// Los eventos llegan parseados como `WsEvent` (espejo del tipo del
// backend). El consumidor pasa un `onEvent` que recibe cada uno. El
// hook también expone `status`:
//   - "connecting" tras montar / tras error
//   - "open" tras la primera connection abierta
//   - "closed" tras 3 reconexiones fallidas seguidas → la PWA cambia a
//     modo degradado (F7).

import { useEffect, useRef, useState } from "react";

import { getCashierSession } from "../storage.js";

// Espejo del type del backend (apps/api/src/realtime/store-events.ts).
// Si el backend amplía la lista, mantenemos sincronizado a mano.
export type StoreEvent =
  | {
      type: "table.opened";
      tableId: string;
      ticketId: string;
      byEmail: string;
      at: string;
    }
  | {
      type: "table.lineAdded";
      tableId: string;
      ticketId: string;
      line: { id: string; sku: string; nameSnapshot: string };
      at: string;
    }
  | {
      type: "table.lineUpdated";
      tableId: string;
      ticketId: string;
      lineId: string;
      at: string;
    }
  | {
      type: "table.lineRemoved";
      tableId: string;
      ticketId: string;
      lineId: string;
      at: string;
    }
  | {
      type: "table.cleared";
      tableId: string;
      ticketId: string;
      reason: string | null;
      at: string;
    }
  | {
      type: "table.paid";
      tableId: string | null;
      ticketId: string;
      holdedDocNumber: string | null;
      at: string;
    }
  | {
      type: "table.grouped";
      mainTableId: string;
      absorbedTableIds: string[];
      at: string;
    }
  | {
      type: "table.ungrouped";
      mainTableId: string;
      at: string;
    }
  | {
      type: "table.linesMoved";
      sourceTableId: string | null;
      destinationTableId: string;
      lineIds: string[];
      at: string;
    };

export type StreamStatus = "connecting" | "open" | "degraded";

export function useStoreEventStream(
  storeId: string | null,
  onEvent: (event: StoreEvent) => void,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const failuresRef = useRef(0);

  useEffect(() => {
    if (!storeId) return;
    const session = getCashierSession();
    if (!session) return;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const open = () => {
      if (cancelled) return;
      setStatus("connecting");
      const baseUrl =
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost:3001";
      // El backend escucha en /ws/store/:storeId; el front se sirve
      // típicamente detrás de un proxy/CDN. Hacemos URL relativa con
      // protocolo wss si la página es https, ws en otro caso.
      const wsBase = baseUrl.replace(/^http/, "ws");
      const url = `${wsBase}/ws/store/${storeId}?token=${encodeURIComponent(
        session.sessionToken,
      )}`;
      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        if (cancelled) return;
        failuresRef.current = 0;
        setStatus("open");
        pingTimer = setInterval(() => {
          if (socket && socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 25_000);
      });

      socket.addEventListener("message", (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data && typeof data.type === "string" && data.type !== "pong") {
            onEventRef.current(data as StoreEvent);
          }
        } catch {
          /* mensaje basura — ignoramos */
        }
      });

      const handleClose = () => {
        if (cancelled) return;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        failuresRef.current += 1;
        if (failuresRef.current >= 10) {
          // ~30s sin conexión → consideramos degradado. El consumidor
          // (mapa, SalePage) decide si poner el banner rojo.
          setStatus("degraded");
        } else {
          setStatus("connecting");
        }
        reconnectTimer = setTimeout(open, 3_000);
      };
      socket.addEventListener("close", handleClose);
      socket.addEventListener("error", handleClose);
    };

    open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (socket) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [storeId]);

  return status;
}
