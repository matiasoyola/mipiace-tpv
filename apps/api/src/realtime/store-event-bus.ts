// Bus in-memory de eventos de mesa (B7 §6). Vive en el proceso de la
// API; cada device suscrito a una `storeId` registra su socket aquí.
// Cuando se emite un evento desde el handler de una mutación, se
// reparte a todos los sockets registrados de ese store.
//
// Decisión deliberada de **bus in-memory** y no Redis pub/sub para el
// piloto: el despliegue Hostinger (ADR-009) corre una única instancia
// de api en docker-compose, así que no hace falta más. Cuando
// escalemos a >1 instancia, sustituimos esta implementación por
// Redis pub/sub manteniendo la misma firma — el resto del código no
// se entera.
//
// El bus es agnóstico al transporte: trabaja con un `send(payload)`
// abstracto. El plugin de WebSocket es el único que sabe cómo
// transformarlo en `socket.send(JSON.stringify(payload))`.

import type { WsEvent } from "./store-events.js";

export interface BusSubscriber {
  send(payload: WsEvent): void;
}

// Lote 4 v1.1 Thalia: throttling defensivo. No más de N eventos por
// canal y ventana — protege a los suscriptores ante una tormenta
// (cashier spamea click "añadir línea" 30 veces en un segundo). Si
// se sobrepasa, el evento se descarta silenciosamente (NO se encola
// para enviar después: la idea es evitar lag perceptible, no
// garantizar entrega de cada uno).
const THROTTLE_MAX_PER_WINDOW = 5;
const THROTTLE_WINDOW_MS = 1_000;

// v1.0-pilotos · Lote 1: el throttle sólo aplica a los eventos de alta
// frecuencia (line-level, los que un cajero puede spamear). Los eventos
// de transición de estado de mesa (opened/cleared/paid/grouped/...)
// NUNCA se descartan — perder un `table.paid` dejaba la mesa pintada
// como ocupada en la otra caja hasta el polling de respaldo (30 s).
const THROTTLED_EVENT_TYPES = new Set<string>([
  "table.lineAdded",
  "table.lineUpdated",
  "table.lineRemoved",
]);

class StoreEventBus {
  private readonly subscribers = new Map<string, Set<BusSubscriber>>();
  // Timestamps (ms) de los últimos eventos por canal. Ventana
  // deslizante. Se purga al broadcast.
  private readonly broadcastTimestamps = new Map<string, number[]>();

  subscribe(storeId: string, subscriber: BusSubscriber): () => void {
    let set = this.subscribers.get(storeId);
    if (!set) {
      set = new Set();
      this.subscribers.set(storeId, set);
    }
    set.add(subscriber);
    return () => {
      const current = this.subscribers.get(storeId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) this.subscribers.delete(storeId);
    };
  }

  broadcast(storeId: string, event: WsEvent): void {
    if (THROTTLED_EVENT_TYPES.has(event.type) && this.isThrottled(storeId)) {
      return;
    }
    const set = this.subscribers.get(storeId);
    if (!set) return;
    for (const sub of set) {
      try {
        sub.send(event);
      } catch {
        // Si un socket falla al enviar (por ejemplo, cerrado entre el
        // dispatch y el send), lo ignoramos. El próximo broadcast lo
        // detectará y el lifecycle del WS plugin lo limpiará.
      }
    }
  }

  private isThrottled(storeId: string): boolean {
    const now = Date.now();
    const windowStart = now - THROTTLE_WINDOW_MS;
    const stamps = this.broadcastTimestamps.get(storeId) ?? [];
    // Drop timestamps fuera de la ventana actual.
    const recent = stamps.filter((t) => t >= windowStart);
    if (recent.length >= THROTTLE_MAX_PER_WINDOW) {
      this.broadcastTimestamps.set(storeId, recent);
      return true;
    }
    recent.push(now);
    this.broadcastTimestamps.set(storeId, recent);
    return false;
  }

  // Sólo para tests / debug.
  subscriberCount(storeId: string): number {
    return this.subscribers.get(storeId)?.size ?? 0;
  }
}

const bus = new StoreEventBus();
export function getStoreEventBus(): StoreEventBus {
  return bus;
}
