// v1.10-offline-un-terminal · pegamento entre la UI y las libs offline.
//
// - refreshOfflineBundle(): descarga el paquete offline (roster+config)
//   con red y lo cachea. Se llama en cada arranque online.
// - offlineLogin(): login de cajero SIN red (PIN verificado en local).
// - deriveOfflineShiftState(): estado de turno para el arranque offline,
//   leído del turno local (IndexedDB).
//
// La renovación del JWT real al volver la red la orquesta App.tsx (que
// conserva el PIN sólo en memoria — nunca se persiste).

import { apiWithDevice } from "../api.js";
import {
  getOfflineConfig,
  saveOfflineBundle,
  setLocalCashierSession,
  verifyPinLocal,
  type CashierRole,
  type OfflineBundle,
} from "./offlineAuth.js";
import { getLocalShift } from "./offlineShift.js";

export type OfflineShiftState =
  | { kind: "needsShiftOpen" }
  | {
      kind: "reanudar";
      shift: { id: string; openedAt: string; cashOpening: string };
    };

/** Descarga y cachea el paquete offline (roster + config). Best-effort:
 *  si falla (sin red), el reflejo local anterior sigue vigente. */
export async function refreshOfflineBundle(): Promise<void> {
  const bundle = await apiWithDevice<OfflineBundle>("/shift/offline-bundle");
  await saveOfflineBundle(bundle);
}

/** Estado de turno para el arranque/login offline, leído del turno
 *  local. Un turno local sin cerrar → reanudar; si no, abrir turno. El
 *  forceClose (turno de un día anterior) no se resuelve offline —
 *  requiere el cierre real; se documenta como fuera de alcance offline. */
export async function deriveOfflineShiftState(): Promise<OfflineShiftState> {
  const shift = await getLocalShift();
  if (shift && !shift.closedAt) {
    return {
      kind: "reanudar",
      shift: {
        // Preferimos el serverId si el turno ya sincronizó; si no, el
        // localId (los tickets lo usarán como shiftId y el outbox lo
        // reescribirá cuando el shift-open resuelva).
        id: shift.serverId ?? shift.localId,
        openedAt: shift.openedAt,
        cashOpening: String(shift.cashOpening),
      },
    };
  }
  return { kind: "needsShiftOpen" };
}

export interface OfflineLoginUser {
  id: string;
  email: string;
  alias: string | null;
  role: CashierRole;
}

export type OfflineLoginResult =
  | {
      ok: true;
      user: OfflineLoginUser;
      sessionTtlMinutes: number;
      shiftState: OfflineShiftState;
    }
  | {
      ok: false;
      reason: "rate_limited" | "invalid" | "no_bundle";
      lockedUntilMs?: number;
      attemptsRemaining?: number;
    };

const DEFAULT_SESSION_TTL_MINUTES = 720;

/** Login de cajero offline: verifica el PIN en local, emite la sesión de
 *  cajero local y devuelve el estado de turno. */
export async function offlineLogin(
  email: string,
  pin: string,
): Promise<OfflineLoginResult> {
  const res = await verifyPinLocal(email, pin);
  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      lockedUntilMs: res.lockedUntilMs,
      attemptsRemaining: res.attemptsRemaining,
    };
  }
  const config = await getOfflineConfig();
  const ttl = config?.cashierSessionTtlMinutes ?? DEFAULT_SESSION_TTL_MINUTES;
  await setLocalCashierSession(res.user, ttl);
  return {
    ok: true,
    user: res.user,
    sessionTtlMinutes: ttl,
    shiftState: await deriveOfflineShiftState(),
  };
}
