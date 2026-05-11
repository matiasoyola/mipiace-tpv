import { z } from "zod";

export const HoldedEnv = z.object({
  HOLDED_API_KEY: z
    .string()
    .min(1, "Falta HOLDED_API_KEY en spike/holded/.env"),
  HOLDED_BASE_URL: z.string().url().default("https://api.holded.com/api"),
  HOLDED_TEST_NUMSERIE: z.string().default("TPV-SPIKE-01"),
});

export type HoldedEnv = z.infer<typeof HoldedEnv>;

export interface HoldedClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

export class HoldedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: unknown,
  ) {
    super(`Holded API ${status} on ${url}`);
    this.name = "HoldedApiError";
  }
}

// Holded responde a veces HTTP 2xx con cuerpo HTML cuando el endpoint
// no existe (observado en spike 01: GET /invoicing/v1/warehouse → 200 +
// página "404 · Holded"). Para no propagar HTML como si fuera JSON,
// validamos el Content-Type y lanzamos este error si no es JSON.
export class HoldedInvalidResponseError extends Error {
  constructor(
    public readonly method: string,
    public readonly url: string,
    public readonly status: number,
    public readonly contentType: string | null,
    public readonly bodyPreview: string,
  ) {
    super(
      `Holded responded with non-JSON content (HTTP ${status}, content-type=${contentType ?? "none"}) on ${method} ${url}`,
    );
    this.name = "HoldedInvalidResponseError";
  }
}

// Cliente vía API Key. El header se llama literalmente `key` (no Bearer),
// confirmado en legacy/mipiace-tpv/server.js. Cuando se monte OAuth, será
// un segundo `HoldedClient` detrás de la misma interfaz (ADR-004).
export class ApiKeyClient implements HoldedClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.holded.com/api",
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set("key", this.apiKey);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const method = (init.method ?? "GET").toUpperCase();
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();

    if (!res.ok) {
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* texto plano */
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
