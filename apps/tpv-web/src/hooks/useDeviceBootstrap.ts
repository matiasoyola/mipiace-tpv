import { useCallback, useEffect, useState } from "react";

import { apiWithDevice, ApiError } from "../api.js";
import {
  clearAllDeviceState,
  getDeviceToken,
} from "../storage.js";

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
      setState({ kind: "paired", data });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Device revocado o token corrupto — limpia todo.
        clearAllDeviceState();
        setState({ kind: "unpaired" });
      } else {
        // Errores de red: reintentar más adelante. Para no dejar la PWA
        // colgada en "loading" indefinidamente, asumimos "paired" con
        // los últimos datos conocidos no es posible (no cacheamos).
        // Dejamos "loading" y que el caller pueda reintentar.
        setState({ kind: "loading" });
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
