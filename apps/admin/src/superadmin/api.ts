// Cliente HTTP del super-admin. Coexiste con el cliente per-tenant
// (api.ts en el directorio padre) usando keys distintas en localStorage
// para que ambas sesiones puedan vivir en el mismo navegador sin
// pisarse. El token super-admin SIEMPRE va en localStorage (no
// sessionStorage) — la consola la usa Matías desde su equipo.

const ACCESS_KEY = "super_admin_access_token";
const REFRESH_KEY = "super_admin_refresh_token";

export interface SuperAdminTokens {
  accessToken: string;
  refreshToken: string;
}

export function readSuperAdminTokens(): SuperAdminTokens | null {
  const a = localStorage.getItem(ACCESS_KEY);
  const r = localStorage.getItem(REFRESH_KEY);
  return a && r ? { accessToken: a, refreshToken: r } : null;
}

export function storeSuperAdminTokens(t: SuperAdminTokens): void {
  localStorage.setItem(ACCESS_KEY, t.accessToken);
  localStorage.setItem(REFRESH_KEY, t.refreshToken);
}

export function clearSuperAdminTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class SuperAdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SuperAdminApiError";
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  retryOnUnauthorized?: boolean;
}

export async function superApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const tokens = readSuperAdminTokens();
  const headers: Record<string, string> = { Accept: "application/json" };
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
      storeSuperAdminTokens(refreshed);
      return superApi<T>(path, { ...options, retryOnUnauthorized: false });
    }
    clearSuperAdminTokens();
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
    const code =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP_${res.status}`;
    const message =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Request failed (${res.status})`;
    throw new SuperAdminApiError(res.status, code, message, parsed);
  }
  return parsed as T;
}

/**
 * A5 · descarga un binario protegido por la sesión super-admin.
 *
 * `superApi` sólo habla JSON, y un `<img src>` o un `<a href>` no llevan la
 * cabecera `Authorization`: por eso las capturas se piden con fetch y se
 * pintan desde un object URL. Es lo que permite que el endpoint del binario
 * exija sesión de verdad en vez de ser una URL adivinable.
 *
 * Quien llame es responsable de `URL.revokeObjectURL`.
 */
export async function superApiBlob(
  path: string,
  retryOnUnauthorized = true,
): Promise<Blob> {
  const tokens = readSuperAdminTokens();
  const headers: Record<string, string> = {};
  if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  const res = await fetch(`/api${path}`, { headers });
  if (res.status === 401 && retryOnUnauthorized && tokens) {
    const refreshed = await tryRefresh(tokens.refreshToken);
    if (refreshed) {
      storeSuperAdminTokens(refreshed);
      return superApiBlob(path, false);
    }
    clearSuperAdminTokens();
  }
  if (!res.ok) {
    throw new SuperAdminApiError(
      res.status,
      `HTTP_${res.status}`,
      res.status === 404
        ? "Esa captura ya no existe o ha caducado."
        : `No se pudo descargar (${res.status})`,
    );
  }
  return res.blob();
}

async function tryRefresh(refreshToken: string): Promise<SuperAdminTokens | null> {
  try {
    const res = await fetch("/api/super-admin/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SuperAdminTokens;
  } catch {
    return null;
  }
}
