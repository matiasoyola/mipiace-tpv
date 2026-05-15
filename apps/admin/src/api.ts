// Cliente HTTP del admin.
//
// Almacenamiento de sesión:
//   - Por defecto, sessionStorage: el propietario cierra pestaña → sale.
//   - Con "Recuérdame" en login, localStorage: persiste hasta logout o
//     hasta que /auth/refresh rechace el token. El backend rota el TTL
//     del refresh según el flag remember (B2 §4.3).

const ACCESS_KEY = "mipiacetpv-admin-access";
const REFRESH_KEY = "mipiacetpv-admin-refresh";
const REMEMBER_KEY = "mipiacetpv-admin-remember";
// B-SuperAdmin: cuando el super-admin abre una pestaña de impersonación,
// el token efímero se guarda aquí (sessionStorage por pestaña — no
// contamina las demás pestañas ni la sesión normal). El AdminShell
// detecta este key y monta el banner rojo + countdown. NO hay
// refresh — al caducar, hay que reabrir desde la consola super-admin.
const IMPERSONATION_KEY = "mipiacetpv-admin-impersonation-access";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export function readImpersonationToken(): string | null {
  return sessionStorage.getItem(IMPERSONATION_KEY);
}

export function storeImpersonationToken(token: string): void {
  sessionStorage.setItem(IMPERSONATION_KEY, token);
}

export function clearImpersonationToken(): void {
  sessionStorage.removeItem(IMPERSONATION_KEY);
}

export function readTokens(): AuthTokens | null {
  // Impersonation siempre gana cuando existe (sólo vive en sessionStorage
  // de esta pestaña). Devolvemos un par sintético con el mismo token en
  // accessToken y refreshToken: el refresh sería rechazado por el
  // backend, pero el cliente nunca intenta refresh con un JWT
  // impersonation porque al caducar el banner pide reabrir.
  const imp = readImpersonationToken();
  if (imp) return { accessToken: imp, refreshToken: imp };
  // Preferimos localStorage si existe (sesiones "Recuérdame"). Si no,
  // fallback a sessionStorage para sesiones del browser actual.
  const a = localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY);
  const r = localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY);
  return a && r ? { accessToken: a, refreshToken: r } : null;
}

export interface JwtPayloadView {
  role?: "OWNER" | "MANAGER" | "CASHIER";
  purpose?: string;
  readOnly?: boolean;
  tid?: string;
  exp?: number;
}

export function decodeJwtPayload(token: string): JwtPayloadView | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(
      atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as JwtPayloadView;
  } catch {
    return null;
  }
}

export interface ImpersonationState {
  active: true;
  expiresAt: number; // epoch ms
  tenantId: string | null;
}

export function readImpersonationState(): ImpersonationState | null {
  const imp = readImpersonationToken();
  if (!imp) return null;
  const payload = decodeJwtPayload(imp);
  if (!payload || payload.purpose !== "impersonation") return null;
  return {
    active: true,
    expiresAt: (payload.exp ?? 0) * 1000,
    tenantId: payload.tid ?? null,
  };
}

export function isRemembered(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === "1";
}

export function storeTokens(tokens: AuthTokens, options: { remember?: boolean } = {}): void {
  const remember = options.remember === true;
  // Limpiar el otro storage para evitar tokens duplicados en sitios
  // distintos (si en login pasamos de remember=true a remember=false).
  if (remember) {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    localStorage.setItem(REMEMBER_KEY, "1");
  } else {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  }
}

// Refresh-on-rotation: cuando el /auth/refresh nos da tokens nuevos,
// los guardamos en el mismo storage del original (no cambiamos el
// modo Recuérdame en pleno vuelo).
function refreshTokens(tokens: AuthTokens): void {
  if (isRemembered()) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  } else {
    sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  }
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  // NO limpiamos el impersonation token aquí — su ciclo de vida lo
  // gestiona el banner (botón "Salir de impersonación") o caducidad.
}

export type AdminRole = "OWNER" | "MANAGER" | "CASHIER";

// Lee el rol del JWT actual (B6 §1). El admin filtra sidebar y oculta
// botones de mutación a MANAGER en función de este valor. Cuando no
// hay sesión o el token está corrupto devolvemos null — la app fuerza
// re-login.
export function readCurrentRole(): AdminRole | null {
  const tokens = readTokens();
  if (!tokens) return null;
  try {
    const parts = tokens.accessToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    const role = payload?.role;
    if (role === "OWNER" || role === "MANAGER" || role === "CASHIER") {
      return role;
    }
    return null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  retryOnUnauthorized?: boolean;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const tokens = readTokens();
  const impersonation = readImpersonationToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (
    res.status === 401 &&
    options.retryOnUnauthorized !== false &&
    tokens &&
    !impersonation
  ) {
    const refreshed = await tryRefresh(tokens.refreshToken);
    if (refreshed) {
      refreshTokens(refreshed);
      return api<T>(path, { ...options, retryOnUnauthorized: false });
    }
    clearTokens();
  }
  if (res.status === 401 && impersonation) {
    // El JWT impersonation caducó (no hay refresh). Limpiamos para que
    // el banner detecte y muestre el aviso.
    clearImpersonationToken();
  }
  const text = await res.text();
  const parsed = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      })()
    : null;
  if (!res.ok) {
    const code = (parsed && typeof parsed === "object" && "error" in parsed
      ? String((parsed as { error: unknown }).error)
      : `HTTP_${res.status}`) as string;
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Request failed (${res.status})`) as string;
    throw new ApiError(res.status, code, message, parsed);
  }
  return parsed as T;
}

async function tryRefresh(refreshToken: string): Promise<AuthTokens | null> {
  try {
    const res = await fetch(`/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AuthTokens;
    return data;
  } catch {
    return null;
  }
}
