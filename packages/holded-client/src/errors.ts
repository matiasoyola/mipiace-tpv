// Errores tipados del cliente Holded.
//
// Holded miente de tres formas distintas y necesitamos un error por cada una:
//
//   1. `HoldedApiError`        — 4xx / 5xx con cuerpo JSON limpio
//                                `{ status: 0, info: "<motivo>" }` o texto plano.
//   2. `HoldedInvalidResponseError` — 200 OK + HTML cuando el endpoint no
//                                existe (spike §01.B). No es transitorio.
//   3. `HoldedSilentRejectError` — 200 OK + `{ status: 1, info: "Updated" }`
//                                pero el GET-back demuestra que Holded ha
//                                descartado silenciosamente lo que enviamos
//                                (ADR-010, spike §04.D).
//   4. `HoldedSubscriptionSuspendedError` — caso especial del 402. La key es
//                                válida pero la cuenta de Holded está
//                                suspendida por impago (spike §01.A).
//                                Mensaje específico para el propietario.

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

export class HoldedInvalidResponseError extends Error {
  constructor(
    public readonly method: string,
    public readonly url: string,
    public readonly status: number,
    public readonly contentType: string | null,
    public readonly bodyPreview: string,
  ) {
    super(
      `Holded responded with non-JSON content (HTTP ${status}, content-type=${
        contentType ?? "none"
      }) on ${method} ${url}`,
    );
    this.name = "HoldedInvalidResponseError";
  }
}

export interface SilentRejectMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

// Lanzado cuando Holded devolvió 2xx en una escritura pero el GET-back
// posterior demuestra que el cambio no se aplicó como pedimos.
// Lleva la lista de invariantes que fallaron para que la bandeja de
// `SYNC_FAILED` del encargado pueda enseñar exactamente qué no cuadró.
export class HoldedSilentRejectError extends Error {
  constructor(
    public readonly operation: string,
    public readonly url: string,
    public readonly mismatches: SilentRejectMismatch[],
    public readonly storedSnapshot?: unknown,
  ) {
    const summary = mismatches
      .map((m) => `${m.field}: expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.actual)}`)
      .join("; ");
    super(`Holded silently rejected ${operation} on ${url}: ${summary}`);
    this.name = "HoldedSilentRejectError";
  }
}

export class HoldedSubscriptionSuspendedError extends Error {
  constructor(
    public readonly url: string,
    public readonly body: unknown,
  ) {
    super(
      `Holded subscription is suspended (HTTP 402). Url=${url}. ` +
        `El propietario debe regularizar el pago en su cuenta Holded.`,
    );
    this.name = "HoldedSubscriptionSuspendedError";
  }
}
