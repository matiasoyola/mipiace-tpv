import { useCallback, useEffect, useState } from "react";

import { apiWithDevice } from "../api.js";
import {
  clearAllDeviceState,
  getDeviceToken,
} from "../storage.js";
import { decideAfterBootstrapError } from "./bootstrap-decision.js";

export interface DeviceMeResponse {
  device: { id: string; name: string | null; pairedAt: string };
  register: { id: string; name: string; numSerieHolded: string | null };
  store: { id: string; name: string };
  tenant: { id: string; name: string; cashierAutoLogoutMinutes: number };
}

export type BootstrapState =
  | { kind: "loading" }
  | { kind: "unpaired" }
  | { kind: "paired"; data: DeviceMeResponse };

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
      if (decideAfterBootstrapError(err) === "purge") {
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
