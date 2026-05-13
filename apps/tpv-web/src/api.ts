// Cliente HTTP del TPV. Tres modos de auth:
//   - apiPublic:    sin auth (POST /devices/pair)
//   - apiWithDevice: header X-Device-Token (GET /devices/me, cashier-login)
//   - apiWithCashier: Authorization Bearer <sessionToken> (shift/*)
//
// El backend está al otro lado del proxy de Vite en dev (/api/* →
// 127.0.0.1:3001), y de Caddy en prod.

import {
  getCashierSession,
  getDeviceToken,
} from "./storage.js";

const BASE_URL = (
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  "/api"
).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;
  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

interface ApiOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send<T>(path: string, opts: ApiOpts): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  };
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  let data: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      // server devolvió no-JSON; lo dejamos como string
      data = text;
    }
  }
  if (!res.ok) {
    const errBody =
      data && typeof data === "object" && data !== null
        ? (data as { error?: string; message?: string })
        : null;
    throw new ApiError(
      res.status,
      errBody?.message ?? res.statusText ?? "Request failed",
      errBody?.error,
      data,
    );
  }
  return data as T;
}

export function apiPublic<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  return send<T>(path, opts);
}

export function apiWithDevice<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const token = getDeviceToken();
  if (!token) {
    return Promise.reject(
      new ApiError(401, "Device no emparejado", "DEVICE_TOKEN_REQUIRED"),
    );
  }
  return send<T>(path, {
    ...opts,
    headers: { ...opts.headers, "X-Device-Token": token },
  });
}

export function apiWithCashier<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const session = getCashierSession();
  if (!session) {
    return Promise.reject(
      new ApiError(401, "Sin sesión de cajero", "UNAUTHENTICATED"),
    );
  }
  return send<T>(path, {
    ...opts,
    headers: {
      ...opts.headers,
      Authorization: `Bearer ${session.sessionToken}`,
    },
  });
}
