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
      if (decideAfterBootstrapError(err) === "purge") {
        // Sólo borramos cuando el backend confirma que el dispositivo
        // está revocado o el JWT ha caducado — un 401 sin código (o con
        // código que no entendemos) probablemente es un proxy o un
        // restart transitorio y NO debe desemparejar al cliente.
        clearAllDeviceState();
        setState({ kind: "unpaired" });
      } else {
        // Errores de red o 401 ambiguos: reintentar más adelante. Para
        // no dejar la PWA colgada en "loading" indefinidamente, dejamos
        // "loading" y que el caller pueda reintentar.
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
