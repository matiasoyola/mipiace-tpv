import {
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
} from "./errors.js";

// Interfaz pública del cliente. ApiKeyClient es la implementación de MVP.
// Cuando se monte OAuth (v2, ADR-004) será un segundo cliente detrás de
// la misma interfaz.
export interface HoldedClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  // v1.2-Lite-fix1 Bug-Imagenes-Holded: GET binario sin validación de
  // Content-Type. Necesario para `/products/{id}/image`, que Holded
  // sirve como JPEG aunque el HEAD anuncie text/html (spike 2026-05-22).
  // Opcional para que los mocks legacy de tests sigan tipando — el
  // ApiKeyClient real siempre lo implementa.
  fetchBinary?(
    path: string,
    opts?: FetchBinaryOptions,
  ): Promise<FetchBinaryResult>;
}

export interface FetchBinaryOptions {
  signal?: AbortSignal;
  // Tamaño máximo aceptado. Si el body supera el límite, throw — no
  // dejamos basura en memoria. Default: sin límite (caller decide).
  maxBytes?: number;
  // Timeout total del request. Default: sin timeout (caller decide).
  timeoutMs?: number;
}

export interface FetchBinaryResult {
  status: number;
  bytes: Buffer;
  // El Content-Type que devuelve Holded es POCO fiable en estas rutas
  // (siempre text/html en HEAD aunque GET devuelva JPEG). Lo dejamos
  // disponible por si el caller quiere loguearlo, pero la detección real
  // del tipo se hace por magic bytes sobre `bytes`.
  contentType: string | null;
}

export interface HoldedClientOptions {
  baseUrl?: string;
  // Inyectable para tests. Por defecto usa `globalThis.fetch`.
  fetchImpl?: typeof fetch;
}

export const DEFAULT_HOLDED_BASE_URL = "https://api.holded.com/api";

// Cliente vía API Key. Header literal `key: <api_key>` (NO Bearer);
// confirmado en spike §00 setup. Valida Content-Type para detectar el
// caso 200+HTML (endpoint inexistente), e intercepta el 402 cuando la
// cuenta del propietario está suspendida (spike §01.A).
export class ApiKeyClient implements HoldedClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options: HoldedClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_HOLDED_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set("key", this.apiKey);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const method = (init.method ?? "GET").toUpperCase();
    const res = await this.fetchImpl(url, { ...init, headers });
    const text = await res.text();

    if (!res.ok) {
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* texto plano */
      }
      if (res.status === 402) {
        throw new HoldedSubscriptionSuspendedError(url, body);
      }
      throw new HoldedApiError(res.status, url, body);
    }

    const contentType = res.headers.get("content-type");
    const isJson =
      contentType !== null &&
      /^application\/(json|.+\+json)\b/i.test(contentType);

    if (!isJson) {
      throw new HoldedInvalidResponseError(
        method,
        url,
        res.status,
        contentType,
        text.slice(0, 200),
      );
    }

    return (text ? JSON.parse(text) : null) as T;
  }

  async fetchBinary(
    path: string,
    opts: FetchBinaryOptions = {},
  ): Promise<FetchBinaryResult> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers();
    headers.set("key", this.apiKey);
    headers.set("Accept", "*/*");

    const internal = new AbortController();
    const timer =
      opts.timeoutMs != null && opts.timeoutMs > 0
        ? setTimeout(() => internal.abort(), opts.timeoutMs)
        : null;
    const signal = opts.signal
      ? combineSignals(opts.signal, internal.signal)
      : internal.signal;

    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers,
        signal,
      });
      if (res.status === 402) {
        // Suspensión: mismo error que en `request`, para que la capa de
        // sync detecte la cuenta sin pago y la deje fuera del ciclo.
        throw new HoldedSubscriptionSuspendedError(url, null);
      }
      if (!res.ok) {
        // 404 sería raro en `/products/{id}/image` (Holded responde 200
        // con HTML para productos sin imagen). Si llega, lo propagamos.
        let body: unknown = null;
        try {
          body = await res.text();
        } catch {
          /* body opcional */
        }
        throw new HoldedApiError(res.status, url, body);
      }

      const contentType = res.headers.get("content-type");
      const max = opts.maxBytes ?? Number.POSITIVE_INFINITY;
      const reader = res.body?.getReader();
      let bytes: Buffer;
      if (!reader) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > max) {
          throw new Error(
            `fetchBinary: body excede ${max} bytes (got ${ab.byteLength})`,
          );
        }
        bytes = Buffer.from(ab);
      } else {
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > max) {
            try {
              await reader.cancel();
            } catch {
              /* socket ya cancelado */
            }
            throw new Error(
              `fetchBinary: body excede ${max} bytes (acumulados ${total})`,
            );
          }
          chunks.push(Buffer.from(value));
        }
        bytes = Buffer.concat(chunks);
      }
      return { status: res.status, bytes, contentType };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// Combina dos AbortSignals: aborta cuando cualquiera de los dos lo hace.
// Usado para chainar el timeout interno con el signal externo del caller.
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbortA = () => ctrl.abort(a.reason);
  const onAbortB = () => ctrl.abort(b.reason);
  a.addEventListener("abort", onAbortA, { once: true });
  b.addEventListener("abort", onAbortB, { once: true });
  return ctrl.signal;
}
