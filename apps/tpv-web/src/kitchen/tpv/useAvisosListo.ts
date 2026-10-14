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
//
// ── kds-2-wifi · EL «LISTO» SIN INTERNET ──────────────────────────────
//
// Las tres formas de arriba pasan por la nube, así que con internet caído
// no queda ninguna: la cocina tacha, la tarjeta pasa a «Lista» y el
// camarero no se entera. Así que se añade una cuarta, que sólo corre
// cuando la nube no contesta: **se le pregunta a la tablet por la wifi**
// (`SONDEO`, cada 4 s) y lo que contesta se mezcla con lo de la nube.
//
// Se MEZCLA y no se sustituye, y por un caso real: puede haber tarjetas
// que quedaran listas ANTES de que se cayera internet y que la nube ya
// hubiera contado. Si la lista de la wifi reemplazara a la otra,
// desaparecerían de la banda en el momento en que se va la red — justo
// cuando el camarero más depende de ella.
//
// Y «Servido» sale por los DOS caminos, como todo lo que manda el TPV: por
// la nube para que quede el tiempo en el pase, y por la wifi para que la
// tarjeta se vaya de la columna «Listas» de la tablet aunque no haya
// internet.

import { useCallback, useEffect, useState } from "react";

import { apiWithCashier } from "../../api.js";
import { newId } from "../../lib/ids.js";
import type { KitchenSection } from "../secciones.js";
import {
  CAMINO_APAGADO,
  type CaminoDirecto,
} from "./useCaminoDirecto.js";

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
  /** kds-2-wifi · el camino directo de la tienda, que monta `TpvHome`. */
  camino?: CaminoDirecto;
}): AvisosListo {
  const [listas, setListas] = useState<ComandaLista[]>([]);
  const camino = opts.camino ?? CAMINO_APAGADO;

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

  // kds-2-wifi · lo que las pantallas dicen por la wifi que tienen listo,
  // en la misma forma que lo de la nube. Sólo hay algo aquí cuando la nube
  // no contesta: es `useCaminoDirecto` el que decide cuándo sondear.
  //
  // `orderId` NO existe todavía para una tarjeta que sólo ha llegado por la
  // wifi (el `kitchen_orders.id` nace cuando el envío sube), así que se usa
  // el `clientSendId` con un prefijo. Es lo que viaja en el `SERVIDO` del
  // camino directo, y lo que impide que el TPV crea que tiene un id del
  // servidor y le pegue un POST que daría 404.
  const porWifi: ComandaLista[] = [];
  for (const r of camino.listasPorWifi) {
    for (const l of r.respuesta?.listas ?? []) {
      porWifi.push({
        orderId: `${LAN_PREFIJO}${l.clientSendId}:${l.section}`,
        ticketId: l.ticketId,
        tableId: l.tableId,
        tableName: l.tableName,
        section: l.section,
        number: 0,
        readyAt: l.readyAt,
      });
    }
  }

  // Mezcla sin duplicar: una tarjeta que la nube ya contó no se repite en
  // la banda porque haya contestado también por la wifi. Se cruza por
  // mesa + sección, que es lo único común a los dos caminos.
  const vistas = new Set(listas.map((l) => `${l.tableId ?? ""}:${l.section}`));
  const todas = [
    ...listas,
    ...porWifi.filter(
      (l) => !vistas.has(`${l.tableId ?? ""}:${l.section}`),
    ),
  ].sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt));

  const marcarServido = useCallback(
    async (orderId: string) => {
      // Optimista: la banda desaparece en el acto y no cuando el servidor
      // conteste. Si el POST falla, el refresco la devuelve — y mientras,
      // el camarero ya está andando hacia la mesa.
      setListas((prev) => prev.filter((l) => l.orderId !== orderId));

      // kds-2-wifi · una tarjeta que sólo llegó por la wifi no tiene id de
      // servidor: su «Servido» sale SÓLO por la wifi, y la hora en el pase
      // la sube la tablet con su libro de marcas cuando vuelva la red.
      if (orderId.startsWith(LAN_PREFIJO)) {
        const resto = orderId.slice(LAN_PREFIJO.length);
        const corte = resto.lastIndexOf(":");
        const clientSendId = corte > 0 ? resto.slice(0, corte) : resto;
        const section = corte > 0 ? resto.slice(corte + 1) : "COCINA";
        await camino.mandarPorWifi("SERVIDO", newId(), {
          clientSendId,
          section,
        });
        return;
      }

      try {
        // Los dos caminos. `allSettled` y no `all`: sin internet la nube
        // falla y el «Servido» tiene que llegar igual a la tablet.
        await Promise.allSettled([
          apiWithCashier(`/kitchen/comandas/${orderId}/servido`, {
            method: "POST",
          }),
          camino.mandarPorWifi("SERVIDO", newId(), {
            clientSendId: orderId,
            section: "COCINA",
          }),
        ]);
      } finally {
        recargar();
      }
    },
    [recargar, camino],
  );

  return {
    listas: todas,
    mesasListas: new Set(
      todas.map((l) => l.tableId).filter((x): x is string => x != null),
    ),
    recargar,
    marcarServido,
  };
}

/**
 * Lo que distingue una tarjeta que sólo ha llegado por la wifi.
 *
 * Su `orderId` no es un id del servidor: todavía no existe. El prefijo es
 * lo que impide que el TPV le pegue un `POST /kitchen/comandas/:id/servido`
 * que daría 404 — y lo que hace que ese «Servido» salga por la wifi.
 */
export const LAN_PREFIJO = "lan:";
