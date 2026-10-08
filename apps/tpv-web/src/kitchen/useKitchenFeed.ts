// kds-1-cocina · EL HILO DE LA PANTALLA.
//
// Tres cosas y en este orden de autoridad:
//
//   1. **El GET es la verdad.** `GET /kitchen/comandas` al montar, al
//      reconectar y cada `RECARGA_MS`. Es lo que hace que una pantalla que
//      estuvo veinte minutos sin red vuelva con el servicio entero y no
//      con lo que se perdió.
//   2. **El socket son avisos.** Cada evento de cocina dispara un GET.
//      No se aplica el evento al estado local: ninguno lleva la comanda
//      dentro (ver `realtime/store-events.ts`), y aplicar parches en el
//      orden en que lleguen es como se corrompe una pantalla.
//   3. **El latido.** Cada GET refresca el `lastSeenAt` del dispositivo en
//      el servidor, que es lo que el TPV mira para decidir si saca el papel
//      de respaldo (decisión 9). Así que el GET periódico no es sólo para
//      refrescar: es el pulso.
//
// ── SIN CONEXIÓN · decisión 9 ─────────────────────────────────────────
//
// `offline` se pone cuando **el último GET falló**, no cuando el socket se
// cae. El socket se cae por mil motivos (un proxy, un reinicio) y la
// pantalla seguiría recibiendo comandas por el GET; poner la pantalla
// entera en rojo por eso sería el aviso que nadie se cree a la tercera vez.
// Lo que de verdad significa «las comandas no llegan» es que el servidor no
// contesta.
//
// Y al volver, lo pendiente llega marcado «llegó tarde»
// (`Comanda.lateArrival`): lo pinta la tarjeta, no este hook.

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiWithDevice } from "../api.js";
import { getDeviceToken } from "../storage.js";
import type { Comanda, VistaCocina } from "./types.js";

/**
 * Cada 20 s.
 *
 * No es sólo refresco: es el latido que el TPV mira. La ventana del
 * servidor son 90 s (`LATIDO_VIVO_MS`), así que tres pasadas perdidas son
 * una caída de verdad y un bache de wifi no saca papel que nadie pidió.
 */
export const RECARGA_MS = 20_000;

/** Reintento tras un GET fallido. Corto: la pantalla está en rojo. */
const REINTENTO_MS = 4_000;

/** El `ping` del socket, para que un proxy no lo cierre por inactividad. */
const PING_MS = 25_000;

export interface FeedCocina {
  vista: VistaCocina | null;
  offline: boolean;
  /** Hora del servidor en el último GET, ya corregida por el reloj local. */
  ahora: string;
  recargar: () => void;
  /** Las «Listas» pendientes de «Servido»: la columna estrecha. */
  listas: Comanda[];
}

export function useKitchenFeed(): FeedCocina {
  const [vista, setVista] = useState<VistaCocina | null>(null);
  const [offline, setOffline] = useState(false);
  // El desvío entre el reloj del servidor y el de la tablet, medido en el
  // último GET. Los minutos del semáforo se cuentan con la hora local
  // CORREGIDA por este desvío: así suben de minuto entre dos GET sin
  // esperar al siguiente, y sin creerse el reloj de la tablet.
  const desvioRef = useRef(0);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recargar = useCallback(async () => {
    try {
      const data = await apiWithDevice<VistaCocina>("/kitchen/comandas");
      desvioRef.current = Date.parse(data.serverTime) - Date.now();
      setVista(data);
      setOffline(false);
    } catch (err) {
      // Un 403 del módulo apagado o un 401 de revocada NO son «sin
      // conexión»: el servidor contestó. El contenedor de arriba
      // (`App`) ya los trata al arrancar; aquí lo que importa es no
      // pintar «las comandas no llegan» cuando el problema es otro.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        setOffline(false);
        return;
      }
      setOffline(true);
    }
  }, []);

  // El bucle del GET. Se reprograma solo y con el intervalo corto mientras
  // esté en rojo.
  useEffect(() => {
    let vivo = true;
    const ciclo = async () => {
      if (!vivo) return;
      await recargar();
      if (!vivo) return;
      timerRef.current = setTimeout(ciclo, offline ? REINTENTO_MS : RECARGA_MS);
    };
    void ciclo();
    return () => {
      vivo = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `offline` en las dependencias a propósito: al caer, el ciclo se
    // reinicia con el intervalo corto, y al volver con el largo.
  }, [recargar, offline]);

  // El reloj de la pantalla: un tick por segundo para que los minutos
  // suban cuando toca y el parpadeo del semáforo se dispare en el momento
  // en que cruza. Un tick por minuto dejaría una tarjeta marcando «19 min»
  // en verde hasta cincuenta segundos después de pasar a ámbar.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // El socket. Avisos, no estado.
  useEffect(() => {
    const token = getDeviceToken();
    if (!token) return;
    let cerrado = false;
    let ws: WebSocket | null = null;
    let reconexion: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const abrir = () => {
      if (cerrado) return;
      const base =
        (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env
          ?.VITE_API_URL ?? "/api";
      const url = new URL(
        `${base.replace(/\/$/, "")}/ws/kitchen`,
        window.location.origin,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      try {
        ws = new WebSocket(url.toString());
      } catch {
        reconexion = setTimeout(abrir, REINTENTO_MS);
        return;
      }
      ws.onopen = () => {
        // El token va en el PRIMER MENSAJE y no en la URL: no caduca
        // nunca, así que en una query string acabaría en los logs de
        // acceso de Caddy y de cualquier proxy. Ver `kitchen/ws-route.ts`.
        ws?.send(JSON.stringify({ type: "hello", token }));
        ping = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_MS);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as { type?: string };
          if (!data.type) return;
          if (data.type === "pong" || data.type === "ready") return;
          if (data.type.startsWith("kitchen.")) void recargar();
        } catch {
          /* un mensaje que no parsea no es asunto de la pantalla */
        }
      };
      const caido = () => {
        if (ping) clearInterval(ping);
        ping = null;
        if (cerrado) return;
        reconexion = setTimeout(abrir, REINTENTO_MS);
      };
      ws.onclose = caido;
      ws.onerror = caido;
    };
    abrir();
    return () => {
      cerrado = true;
      if (reconexion) clearTimeout(reconexion);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [recargar]);

  // La hora que la pantalla usa para contar: la local corregida por el
  // desvío del servidor. `tick` la fuerza a recalcularse cada segundo.
  const ahora = new Date(Date.now() + desvioRef.current).toISOString();
  void tick;

  return {
    vista,
    offline,
    ahora,
    recargar,
    listas: vista?.ready ?? [],
  };
}
