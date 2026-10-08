import { useCallback, useEffect, useState } from "react";

import { ApiError, apiWithDevice } from "../api.js";
import {
  clearAllDeviceState,
  getDeviceToken,
} from "../storage.js";
import { decideAfterBootstrapError } from "./bootstrap-decision.js";

export interface DeviceMeResponse {
  device: { id: string; name: string | null; pairedAt: string };
  register: { id: string; name: string; numSerieHolded: string | null };
  store: { id: string; name: string };
  tenant: {
    id: string;
    name: string;
    cashierAutoLogoutMinutes: number;
    // v1.11-cierre-de-dia · el negocio exige cuadrar caja para cerrar.
    // Ausente en la caché de un device bootstrapeado antes de v1.11 →
    // se trata como false, que es el default nuevo.
    requireCashCountOnClose?: boolean;
    // kds-1-cocina · la capability del módulo «Cocina». Ausente en la
    // caché de un device bootstrapeado antes del bloque → se trata como
    // false, que es el default de la columna.
    kitchenDisplayEnabled?: boolean;
  };
  // kds-1-cocina · los ajustes de cocina de ESTA tienda, o `null` con el
  // módulo apagado. El TPV los necesita al arrancar para saber si pinta
  // «Espera» o la fila de tiempos y si el botón de silla va siempre
  // visible.
  kitchen?: {
    courseMode: "ESPERA" | "TIEMPOS";
    seatMode: "ALERGIA" | "SIEMPRE";
    greenMaxMin: number;
    amberMaxMin: number;
    readyBeep: boolean;
  } | null;
}

export type BootstrapState =
  | { kind: "loading" }
  | { kind: "unpaired" }
  // H1 (ADR-016) · la empresa no tiene caja. Estado terminal: no se
  // reintenta, no se desempareja y no se vuelve al PIN. `message` es la
  // frase que mandó el servidor, para no tener dos textos que mantener.
  | { kind: "cajaDisabled"; message: string }
  // kds-1-cocina · esta tablet es una PANTALLA DE COCINA. La misma APK,
  // otra pantalla (decisión 1). Se llega aquí porque `/devices/me`
  // devolvió 403 KITCHEN_DEVICE_NOT_ALLOWED, que es la respuesta correcta
  // y no un error: el corte vive en la puerta de todas las rutas del TPV.
  | { kind: "kitchen"; data: KitchenMeResponse }
  | { kind: "paired"; data: DeviceMeResponse };

export interface KitchenMeResponse {
  device: { id: string; name: string | null };
  store: { id: string; name: string };
  sections: Array<"BARRA" | "COCINA" | "SALON">;
  settings: { greenMaxMin: number; amberMaxMin: number; readyBeep: boolean };
  /**
   * kds-2-wifi · la hora del SERVIDOR al arrancar. Con ella la tablet
   * calcula su desvío de reloj, y con el desvío mide si un mensaje de la
   * wifi es «demasiado viejo». El reloj de una tablet que lleva horas sin
   * internet no vale para eso.
   *
   * Opcional: una pantalla contra una API de antes del bloque sigue
   * arrancando, sólo que sin camino directo.
   */
  serverTime?: string;
  /**
   * kds-2-wifi · con qué clave se firma y en qué puerto se escucha.
   *
   * Sin esto la tablet **no abre el servidor local**: una pantalla que
   * escuchara sin clave aceptaría cualquier cosa de cualquiera que esté en
   * la wifi del bar.
   */
  lan?: { key: string; port: number; maxAgeMs: number };
}

// v1.10-offline-un-terminal: cacheamos el device-me en localStorage. Un
// terminal ya bootstrapeado que recarga la PWA SIN red (modo avión, VPS
// caído) debe seguir operando el turno offline en vez de quedarse en el
// spinner "loading". Sólo datos no sensibles (ids + nombres +
// auto-logout). Se refresca en cada bootstrap online.
const DEVICE_ME_CACHE_KEY = "mipiacetpv-device-me";

function readCachedDeviceMe(): DeviceMeResponse | null {
  const raw = localStorage.getItem(DEVICE_ME_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceMeResponse;
  } catch {
    return null;
  }
}

function writeCachedDeviceMe(data: DeviceMeResponse): void {
  try {
    localStorage.setItem(DEVICE_ME_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* cuota llena o modo privado — no fatal */
  }
}

export function useDeviceBootstrap(): {
  state: BootstrapState;
  refresh: () => void;
  unpair: () => void;
} {
  const [state, setState] = useState<BootstrapState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    const token = getDeviceToken();
    if (!token) {
      setState({ kind: "unpaired" });
      return;
    }
    try {
      const data = await apiWithDevice<DeviceMeResponse>("/devices/me");
      writeCachedDeviceMe(data);
      setState({ kind: "paired", data });
    } catch (err) {
      const decision = decideAfterBootstrapError(err);
      // H1 · antes esto caía en la rama de abajo y, sin `device-me`
      // cacheado, dejaba el terminal en `loading` reintentando cada 3 s
      // para siempre. Ahora para y lo dice. NO purgamos el token: el
      // dispositivo sigue emparejado, y el día que le enciendan la caja
      // a la empresa arranca sin volver a emparejarlo.
      if (decision === "caja-disabled") {
        setState({
          kind: "cajaDisabled",
          message:
            err instanceof ApiError && err.message
              ? err.message
              : "Esta empresa no tiene el módulo de caja activado.",
        });
        return;
      }
      // kds-1-cocina · «modo cocina». Se pregunta a `/kitchen/me`, que es
      // la única puerta que acepta un `KITCHEN`. Si ESA también falla —el
      // módulo se apagó con la tablet emparejada— se cae a `retry`, que es
      // lo correcto: el aparato sigue emparejado y el día que lo
      // reenciendan arranca sin volver a emparejarlo. Mismo criterio que
      // `cajaDisabled`.
      if (decision === "kitchen") {
        try {
          const k = await apiWithDevice<KitchenMeResponse>("/kitchen/me");
          setState({ kind: "kitchen", data: k });
        } catch {
          setState({ kind: "loading" });
          setTimeout(refresh, 3000);
        }
        return;
      }
      if (decision === "purge") {
        // Sólo borramos cuando el backend confirma que el dispositivo
        // está revocado o el JWT ha caducado — un 401 sin código (o con
        // código que no entendemos) probablemente es un proxy o un
        // restart transitorio y NO debe desemparejar al cliente.
        clearAllDeviceState();
        localStorage.removeItem(DEVICE_ME_CACHE_KEY);
        setState({ kind: "unpaired" });
      } else {
        // v1.10-offline: error de red (o 401 ambiguo). Si tenemos un
        // device-me cacheado de un arranque online previo, seguimos
        // operando OFFLINE con esos datos — el terminal ya estaba
        // bootstrapeado. Igualmente reintentamos en background para
        // revalidar cuando vuelva la red.
        const cached = readCachedDeviceMe();
        if (cached) {
          setState({ kind: "paired", data: cached });
        } else {
          // Sin cache no podemos operar: dejamos "loading" y reintentamos.
          setState({ kind: "loading" });
        }
        setTimeout(refresh, 3000);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    state,
    refresh,
    unpair: () => {
      clearAllDeviceState();
      setState({ kind: "unpaired" });
    },
  };
}
