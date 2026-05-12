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
}
