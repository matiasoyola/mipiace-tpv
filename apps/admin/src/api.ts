// Cliente HTTP del admin. Lee/escribe sesión en sessionStorage (no
// localStorage: si el propietario cierra la pestaña, sale; preferimos
// eso a riesgo de robo del token persistente).

const ACCESS_KEY = "mipiacetpv-admin-access";
const REFRESH_KEY = "mipiacetpv-admin-refresh";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export function readTokens(): AuthTokens | null {
  const a = sessionStorage.getItem(ACCESS_KEY);
  const r = sessionStorage.getItem(REFRESH_KEY);
  return a && r ? { accessToken: a, refreshToken: r } : null;
}

export function storeTokens(tokens: AuthTokens): void {
  sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
  sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
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
  // Si true (default), si el access token caducó intenta refresh + retry.
  retryOnUnauthorized?: boolean;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const tokens = readTokens();
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
  if (res.status === 401 && options.retryOnUnauthorized !== false && tokens) {
    const refreshed = await tryRefresh(tokens.refreshToken);
    if (refreshed) {
      storeTokens(refreshed);
      return api<T>(path, { ...options, retryOnUnauthorized: false });
    }
    clearTokens();
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
