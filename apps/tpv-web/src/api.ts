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
  // v1.0-pilotos · Lote 2 (#9): Content-Type sólo cuando hay body. Un
  // POST sin payload con header JSON hacía que Fastify rechazara el
  // request ("body vacío") antes de llegar al handler — reimprimir,
  // enviar comanda y gift-receipt fallaban siempre.
  const headers: Record<string, string> = {
    ...(opts.body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
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

// v1.0-pilotos · Lote 4 addendum: re-login in situ ante un 401.
//
// Visto en producción (Peluquería Sole): la sesión caducaba a mitad de
// un checkout y el TPV sólo mostraba "Sesión inválida o expirada" sin
// salida, delante de la clienta. Ahora, cuando un request del cajero
// devuelve 401, el wrapper avisa al handler registrado por App (modal
// de PIN in situ, sin navegar — el carrito y el checkout no se tocan) y
// si el re-login tiene éxito reintenta UNA vez la request original con
// el token nuevo. Si el cajero cancela, propagamos el 401 original.
//
// Varias requests con 401 simultáneo comparten el mismo re-login (un
// solo modal); todas reintentan al resolverse.
type SessionExpiredHandler = () => Promise<boolean>;

let sessionExpiredHandler: SessionExpiredHandler | null = null;
let reloginInFlight: Promise<boolean> | null = null;

export function registerSessionExpiredHandler(
  handler: SessionExpiredHandler | null,
): void {
  sessionExpiredHandler = handler;
}

async function requestRelogin(): Promise<boolean> {
  if (!sessionExpiredHandler) return false;
  if (!reloginInFlight) {
    reloginInFlight = sessionExpiredHandler().finally(() => {
      reloginInFlight = null;
    });
  }
  return reloginInFlight;
}

export async function apiWithCashier<T>(
  path: string,
  opts: ApiOpts = {},
): Promise<T> {
  const session = getCashierSession();
  if (!session) {
    // Sin sesión previa no hay nada que "renovar" — mismo contrato que
    // antes (App redirige a PinScreen).
    throw new ApiError(401, "Sin sesión de cajero", "UNAUTHENTICATED");
  }
  try {
    return await send<T>(path, {
      ...opts,
      headers: {
        ...opts.headers,
        Authorization: `Bearer ${session.sessionToken}`,
      },
    });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    const renewed = await requestRelogin();
    if (!renewed) throw err;
    const fresh = getCashierSession();
    if (!fresh) throw err;
    return send<T>(path, {
      ...opts,
      headers: {
        ...opts.headers,
        Authorization: `Bearer ${fresh.sessionToken}`,
      },
    });
  }
}
