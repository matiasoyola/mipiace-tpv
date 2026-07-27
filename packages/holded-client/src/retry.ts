// Reintentos para el cliente Holded (bloque v1.9.9).
//
// Objetivo: que un 429 (cuota/ráfaga) o un 5xx/corte de red puntual no
// tumbe una sincronización ni la subida de un ticket. SOLO se reintentan
// peticiones idempotentes (GET); nunca un POST/PUT/DELETE — el POST de
// creación de salesreceipt jamás debe doblarse.
//
// La API v2 de Holded documenta 429 + `Retry-After` + `X-RateLimit-*`;
// aquí respetamos `Retry-After` cuando viene y hacemos backoff exponencial
// con jitter en el resto de casos transitorios.

export interface RetryOptions {
  // Nº máximo de reintentos (además del intento inicial). Default 4.
  maxRetries: number;
  // Base del backoff exponencial en ms. Default 1000 → 1s, 2s, 4s, 8s.
  baseDelayMs: number;
  // Si `Retry-After` pide esperar más que esto, NO dormimos: dejamos que
  // el 429 suba y que el reencolado (BullMQ) lo gestione. Default 60s.
  maxRetryAfterMs: number;
  // Inyectables para tests (esperas reales y jitter determinista).
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 4,
  baseDelayMs: 1000,
  maxRetryAfterMs: 60_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export function resolveRetryOptions(
  partial?: Partial<RetryOptions>,
): RetryOptions {
  return { ...DEFAULT_RETRY, ...(partial ?? {}) };
}

// 429 (rate limit) y 5xx son transitorios; el resto NO se reintenta
// (incluye el 402 de suspensión y los 4xx de validación).
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Backoff exponencial con jitter: baseDelayMs * 2^intento + [0,250)ms.
// `attempt` empieza en 0 (primer reintento).
export function computeBackoffMs(attempt: number, opts: RetryOptions): number {
  const expo = opts.baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(opts.random() * 250);
  return expo + jitter;
}

// `Retry-After` de Holded viene en SEGUNDOS. Devuelve ms, o null si no
// está o no es un número válido (no soportamos el formato fecha HTTP: no
// lo usa Holded).
export function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw.trim());
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.round(secs * 1000);
}
