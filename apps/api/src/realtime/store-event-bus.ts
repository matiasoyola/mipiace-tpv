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

class StoreEventBus {
  private readonly subscribers = new Map<string, Set<BusSubscriber>>();

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

  // Sólo para tests / debug.
  subscriberCount(storeId: string): number {
    return this.subscribers.get(storeId)?.size ?? 0;
  }
}

const bus = new StoreEventBus();
export function getStoreEventBus(): StoreEventBus {
  return bus;
}
