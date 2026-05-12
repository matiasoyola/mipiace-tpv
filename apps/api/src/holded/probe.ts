// Helper compartido: valida una API Key de Holded haciendo un GET
// barato (la primera página de productos, baseline del spike §02.B).
// Lo usan:
//   - `POST /onboarding/connect-holded` (B1) para validar antes de
//     persistir la key cifrada y encolar el sync inicial.
//   - `POST /auth/me/rotate-holded-key` (B2 §4.2) para validar la
//     nueva clave antes de sobreescribir la antigua.
//   - `POST /auth/me/test-holded-connection` (B2 §4.2) para mostrar
//     en admin "estado de la conexión".
//
// Devuelve un tipo unión discriminado (`ok` true/false). El caller
// mapea cada código de error al HTTP que corresponde — no asumimos
// nada sobre la respuesta al cliente desde aquí, porque la traducción
// puede variar según el contexto (rotación falla → 400; onboarding
// falla → 401; etc.).

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
  listProductsPage,
} from "@mipiacetpv/holded-client";

import { loadEnv } from "../env.js";

export type ProbeFailureCode =
  | "INVALID_HOLDED_KEY"
  | "HOLDED_SUSPENDED"
  | "HOLDED_INVALID_RESPONSE"
  | "HOLDED_UNREACHABLE";

export type ProbeResult =
  | { ok: true }
  | { ok: false; code: ProbeFailureCode; message: string };

// Mensajes en español, listos para mostrar al propietario en admin.
// Si en algún momento queremos i18n, los movemos a un map con keys.
const MESSAGES: Record<ProbeFailureCode, string> = {
  INVALID_HOLDED_KEY:
    "Holded rechaza la API Key. Genera una nueva desde tu admin y reintenta.",
  HOLDED_SUSPENDED:
    "Tu cuenta de Holded está suspendida por impago. Regulariza el pago en Holded y vuelve a intentarlo.",
  HOLDED_INVALID_RESPONSE:
    "Holded ha devuelto una respuesta que no es JSON. Es posible que estén con incidencia.",
  HOLDED_UNREACHABLE:
    "No hemos podido contactar con Holded. Reintenta en unos minutos.",
};

export async function probeHoldedKey(apiKey: string): Promise<ProbeResult> {
  const env = loadEnv();
  const client = new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });
  try {
    await listProductsPage(client, 1);
    return { ok: true };
  } catch (err) {
    if (err instanceof HoldedSubscriptionSuspendedError) {
      return { ok: false, code: "HOLDED_SUSPENDED", message: MESSAGES.HOLDED_SUSPENDED };
    }
    if (err instanceof HoldedApiError && (err.status === 401 || err.status === 403)) {
      return { ok: false, code: "INVALID_HOLDED_KEY", message: MESSAGES.INVALID_HOLDED_KEY };
    }
    if (err instanceof HoldedInvalidResponseError) {
      return {
        ok: false,
        code: "HOLDED_INVALID_RESPONSE",
        message: MESSAGES.HOLDED_INVALID_RESPONSE,
      };
    }
    return {
      ok: false,
      code: "HOLDED_UNREACHABLE",
      message: MESSAGES.HOLDED_UNREACHABLE,
    };
  }
}

// Traducción canónica de código a HTTP status para el caller que no
// quiera decidirlo. INVALID y SUSPENDED mantienen los códigos de B1
// para no romper expectativas del front.
export function probeFailureToHttpStatus(code: ProbeFailureCode): number {
  switch (code) {
    case "INVALID_HOLDED_KEY":
      return 401;
    case "HOLDED_SUSPENDED":
      return 402;
    case "HOLDED_INVALID_RESPONSE":
    case "HOLDED_UNREACHABLE":
      return 502;
  }
}
