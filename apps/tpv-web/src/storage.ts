// Persistencia local de la PWA. Sólo localStorage — la PWA se instala
// como app y se espera que el browser preserve el storage entre
// arranques. Si el usuario limpia datos del sitio o desempareja, todo
// vuelve a vacío.
//
// B-OnboardingV2: cuando hay un modo prueba activo (super-admin abrió
// la pestaña con `?testCashierToken=...`), los getters devuelven los
// valores guardados en sessionStorage por `lib/test-mode.ts` antes que
// los del localStorage. Esto permite que un super-admin pruebe el TPV
// sin contaminar (ni perder) la sesión real del cliente en el mismo
// navegador.

import { readTestModeState } from "./lib/test-mode.js";

const DEVICE_TOKEN_KEY = "mipiacetpv-device-token";
const CASHIER_SESSION_KEY = "mipiacetpv-cashier-session";
const RECENT_CASHIERS_KEY = "mipiacetpv-recent-cashiers";

const MAX_RECENT_CASHIERS = 5;

export function getDeviceToken(): string | null {
  const test = readTestModeState();
  if (test) return test.deviceToken;
  return localStorage.getItem(DEVICE_TOKEN_KEY);
}

export function setDeviceToken(token: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
}

export function clearAllDeviceState(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY);
  localStorage.removeItem(CASHIER_SESSION_KEY);
  localStorage.removeItem(RECENT_CASHIERS_KEY);
}

export interface CashierSession {
  sessionToken: string;
  sessionTtlMinutes: number;
  userId: string;
  email: string;
  role: "MANAGER" | "CASHIER";
}

export function getCashierSession(): CashierSession | null {
  const test = readTestModeState();
  if (test) {
    // El cashierToken es el sessionToken válido del cajero técnico.
    // userId/email/role se rellenan tras el bootstrap; mientras
    // tanto devolvemos un stub que basta para que apiWithCashier
    // adjunte el Bearer.
    return {
      sessionToken: test.cashierToken,
      sessionTtlMinutes: Math.max(1, Math.round((test.expiresAt - Date.now()) / 60_000)),
      userId: "",
      email: "",
      role: "MANAGER",
    };
  }
  const raw = localStorage.getItem(CASHIER_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CashierSession;
  } catch {
    return null;
  }
}

export function setCashierSession(session: CashierSession): void {
  localStorage.setItem(CASHIER_SESSION_KEY, JSON.stringify(session));
}

export function clearCashierSession(): void {
  localStorage.removeItem(CASHIER_SESSION_KEY);
}

export interface RecentCashier {
  email: string;
  // Opcional — se rellena tras el primer login. Antes sólo email.
  initials?: string;
  // ISO de la última vez que se vio. Se usa para ordenar; sin caducidad.
  lastSeenAt: string;
}

export function getRecentCashiers(): RecentCashier[] {
  const raw = localStorage.getItem(RECENT_CASHIERS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RecentCashier[];
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, MAX_RECENT_CASHIERS);
  } catch {
    return [];
  }
}

export function rememberCashier(entry: RecentCashier): void {
  const list = getRecentCashiers().filter((c) => c.email !== entry.email);
  list.unshift(entry);
  localStorage.setItem(
    RECENT_CASHIERS_KEY,
    JSON.stringify(list.slice(0, MAX_RECENT_CASHIERS)),
  );
}
