// kds-1-cocina · LO QUE ESTÁ LISTO, EN TODOS LOS TPV.
//
// Decisión 5: la banda «M4 · listo para servir» sale en **todos los TPV del
// local**, y la mesa de la sala lleva una etiqueta «LISTO» verde. Las dos
// señales salen de aquí, de `GET /kitchen/listas`, que es de la TIENDA y
// no de una mesa: un aviso por mesa sólo llegaría al camarero que ya está
// mirando esa mesa, o sea al único que no lo necesita.
//
// Se refresca de tres formas, y las tres hacen falta:
//
//   1. **al montar**, porque el camarero puede entrar con dos mesas ya
//      listas;
//   2. **con el evento del bus** (`kitchen.order_ready` /
//      `kitchen.order_served`), que es lo que lo hace inmediato;
//   3. **cada `REFRESCO_MS`**, como red por si un evento se perdió — el bus
//      es in-memory y sin garantía de entrega (ver `store-event-bus.ts`).
//
// Un «Servido» en un terminal apaga la banda en TODOS porque el evento
// llega a todos y todos vuelven a pedir la lista. Tiene su fila en la
// tabla de sabotajes: «"Servido" que no limpia».

import { useCallback, useEffect, useState } from "react";

import { apiWithCashier } from "../../api.js";
import type { KitchenSection } from "../secciones.js";

export interface ComandaLista {
  orderId: string;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  section: KitchenSection;
  number: number;
  readyAt: string;
}

/**
 * Cada 30 s.
 *
 * Es la RED, no el camino: lo normal es que el evento del bus llegue en
 * décimas. Media vuelta de minuto es lo que se tarda en bajar de la
 * terraza, así que un aviso que llegara con ese retraso por el camino
 * lento sigue llegando a tiempo.
 */
export const REFRESCO_MS = 30_000;

export interface AvisosListo {
  listas: ComandaLista[];
  /** Los ids de mesa con algo listo: la etiqueta verde de la sala. */
  mesasListas: Set<string>;
  recargar: () => void;
  /** Un toque en la banda o en la etiqueta = «Servido». */
  marcarServido: (orderId: string) => Promise<void>;
}

export function useAvisosListo(opts: {
  /** `Tenant.kitchenDisplayEnabled`. Apagado, no se pide nada. */
  moduloEncendido: boolean;
}): AvisosListo {
  const [listas, setListas] = useState<ComandaLista[]>([]);

  const recargar = useCallback(() => {
    if (!opts.moduloEncendido) {
      setListas([]);
      return;
    }
    void apiWithCashier<{ ready: ComandaLista[] }>("/kitchen/listas")
      .then((d) => setListas(d.ready))
      .catch(() => {
        // Sin red el TPV sigue vendiendo («cobrar siempre se puede»). Lo
        // que no se puede es borrar un aviso que a lo mejor sigue vivo, así
        // que se deja la lista anterior.
      });
  }, [opts.moduloEncendido]);

  useEffect(() => {
    recargar();
    if (!opts.moduloEncendido) return;
    const id = setInterval(recargar, REFRESCO_MS);
    return () => clearInterval(id);
  }, [recargar, opts.moduloEncendido]);

  const marcarServido = useCallback(
    async (orderId: string) => {
      // Optimista: la banda desaparece en el acto y no cuando el servidor
      // conteste. Si el POST falla, el refresco la devuelve — y mientras,
      // el camarero ya está andando hacia la mesa.
      setListas((prev) => prev.filter((l) => l.orderId !== orderId));
      try {
        await apiWithCashier(`/kitchen/comandas/${orderId}/servido`, {
          method: "POST",
        });
      } finally {
        recargar();
      }
    },
    [recargar],
  );

  return {
    listas,
    mesasListas: new Set(
      listas.map((l) => l.tableId).filter((x): x is string => x != null),
    ),
    recargar,
    marcarServido,
  };
}
