// B-OnboardingV2 · Modo prueba del TPV.
//
// El super-admin emite, desde su consola, un par (cashierSessionToken,
// deviceToken) y abre el TPV en una pestaña nueva con esos valores en
// la query string. Al cargar:
//   1. Detectamos los query params, los guardamos en sessionStorage
//      (NO localStorage — no contaminamos sesiones reales en el mismo
//      navegador), limpiamos la URL.
//   2. Las funciones `storage.getDeviceToken()` / `getCashierSession()`
//      prefieren los valores de sessionStorage si hay test mode activo.
//   3. La PWA muestra un banner amarillo persistente con countdown y
//      botón "Salir" que cierra la pestaña.
//
// El token TTL es 24 h, sin refresh. Cuando caduca, el backend devuelve
// 401 y la PWA limpia el sessionStorage y muestra "Sesión caducada".

const TEST_CASHIER_KEY = "mipiacetpv-test-cashier-token";
const TEST_DEVICE_KEY = "mipiacetpv-test-device-token";

export interface TestModeState {
  cashierToken: string;
  deviceToken: string;
  expiresAt: number; // epoch ms
  tenantId: string | null;
}

// Lee y consume los query params si están presentes. Devuelve true si
// había test mode (ya guardado en sessionStorage) — el caller debe
// recargar para que el resto de la app vea el estado limpio.
export function consumeTestModeFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const cashier = params.get("testCashierToken");
  const device = params.get("testDeviceToken");
  if (!cashier || !device) return false;
  sessionStorage.setItem(TEST_CASHIER_KEY, cashier);
  sessionStorage.setItem(TEST_DEVICE_KEY, device);
  // Limpia la URL para no dejar tokens en el historial.
  params.delete("testCashierToken");
  params.delete("testDeviceToken");
  const cleaned = `${window.location.pathname}${
    params.toString() ? `?${params.toString()}` : ""
  }${window.location.hash}`;
  window.history.replaceState({}, document.title, cleaned);
  return true;
}

interface DecodedJwt {
  exp?: number;
  purpose?: string;
  tid?: string;
}

function decodeJwt(token: string): DecodedJwt | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as DecodedJwt;
  } catch {
    return null;
  }
}

export function readTestModeState(): TestModeState | null {
  if (typeof window === "undefined") return null;
  const cashier = sessionStorage.getItem(TEST_CASHIER_KEY);
  const device = sessionStorage.getItem(TEST_DEVICE_KEY);
  if (!cashier || !device) return null;
  const decoded = decodeJwt(cashier);
  if (!decoded || decoded.purpose !== "test-cashier") {
    clearTestMode();
    return null;
  }
  const expiresAt = (decoded.exp ?? 0) * 1000;
  return {
    cashierToken: cashier,
    deviceToken: device,
    expiresAt,
    tenantId: decoded.tid ?? null,
  };
}

export function isTestModeActive(): boolean {
  return readTestModeState() != null;
}

export function clearTestMode(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TEST_CASHIER_KEY);
  sessionStorage.removeItem(TEST_DEVICE_KEY);
}
