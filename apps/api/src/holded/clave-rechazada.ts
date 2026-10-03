// holded-pat · el ÚNICO sitio que sabe qué respuesta de Holded significa
// «clave rechazada», y qué forma de clave no sirve en esta versión.
//
// Vive aparte de `probe.ts` a propósito: el probe es UNA de las tres
// puertas (onboarding/H1), y las otras dos —alta y rotación del
// super-admin— no deben depender de él. Varios tests doblan `probe.js`
// entero con un stub; si el alta importara de ahí, un stub incompleto la
// tumbaría con un 500. La regla de negocio no cuelga del helper que la
// usa primero.
//
// El mapeo duplicado en tres rutas es lo que produjo el bug del 13-09:
// el 400 `{"status":0,"info":"Invalid key"}` con el que Holded contesta a
// un token `pat_` caía en «no hemos podido contactar con Holded» y mandaba
// al implantador a buscar un fallo de red que no existía. Lo medido contra
// Holded real está en `docs/blocks/holded-pat-spike.md`.

import {
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
} from "@mipiacetpv/holded-client";

export type HoldedKeyFailureCode =
  | "INVALID_HOLDED_KEY"
  | "HOLDED_KEY_V1_REQUIRED"
  | "HOLDED_SUSPENDED"
  | "HOLDED_INVALID_RESPONSE"
  | "HOLDED_UNEXPECTED_STATUS"
  | "HOLDED_UNREACHABLE";

// Mensajes en español, listos para mostrar a quien está delante de la
// pantalla. Si en algún momento queremos i18n, pasan a un map con keys.
export const MENSAJES: Record<HoldedKeyFailureCode, string> = {
  INVALID_HOLDED_KEY:
    "Holded rechaza la API Key. Genérala de nuevo en Holded, en Configuración → Más → Desarrolladores, y reintenta.",
  // El token nuevo (`pat_…`) no autentica contra la API v1, que es la
  // única que habla este TPV: el spike lo midió contra Holded real con
  // todas las cabeceras posibles. El mensaje dice qué clave hace falta y
  // dónde se genera, porque el implantador lo lee delante del cliente y
  // tiene que poder resolverlo sin llamar a nadie.
  HOLDED_KEY_V1_REQUIRED:
    "Esa clave es un API Token nuevo de Holded (empieza por «pat_») y esta versión del TPV necesita una API Key v1. " +
    "Genérala en Holded, en Configuración → Más → Desarrolladores, y pega esa.",
  HOLDED_SUSPENDED:
    "Tu cuenta de Holded está suspendida por impago. Regulariza el pago en Holded y vuelve a intentarlo.",
  HOLDED_INVALID_RESPONSE:
    "Holded ha devuelto una respuesta que no es JSON. Es posible que estén con incidencia.",
  HOLDED_UNEXPECTED_STATUS:
    "Holded ha respondido algo que no esperábamos. Reintenta y, si sigue, avisa a Mi Piace.",
  HOLDED_UNREACHABLE:
    "No hemos podido contactar con Holded. Reintenta en unos minutos.",
};

// Los API Token nuevos de Holded tienen la forma `pat_<id>_<secreto>`.
// Se detectan ANTES de tocar la red: no hay ninguna cabecera con la que
// entren en `/invoicing/v1/…` (spike §1), así que gastar una llamada para
// que Holded conteste 400 sólo sirve para que el implantador lea «no
// hemos podido contactar con Holded».
export function esTokenPat(apiKey: string): boolean {
  return apiKey.trim().toLowerCase().startsWith("pat_");
}

// Lo que cuenta como clave rechazada, medido contra Holded real
// (`docs/blocks/holded-pat-spike.md` §1 y §4):
//   - 401, con cualquier cabecera y con cualquier forma de clave;
//   - 403;
//   - 400 cuyo cuerpo trae `info: "Invalid key"` — la respuesta de v1 a
//     un token con forma de `pat_`.
//
// `HOLDED_UNREACHABLE` queda SÓLO para red, timeout y 5xx. Un 4xx que no
// sea un rechazo de clave es `HOLDED_UNEXPECTED_STATUS`: también es un
// 502 para el caller, pero no miente diciendo que Holded no responde.
export function classifyHoldedKeyFailure(err: unknown): {
  code: HoldedKeyFailureCode;
  message: string;
} {
  if (err instanceof HoldedSubscriptionSuspendedError) {
    return { code: "HOLDED_SUSPENDED", message: MENSAJES.HOLDED_SUSPENDED };
  }
  if (err instanceof HoldedInvalidResponseError) {
    return {
      code: "HOLDED_INVALID_RESPONSE",
      message: MENSAJES.HOLDED_INVALID_RESPONSE,
    };
  }
  if (err instanceof HoldedApiError) {
    if (err.status === 401 || err.status === 403) {
      return { code: "INVALID_HOLDED_KEY", message: MENSAJES.INVALID_HOLDED_KEY };
    }
    if (err.status === 400 && infoDeHolded(err.body) === "invalid key") {
      return { code: "INVALID_HOLDED_KEY", message: MENSAJES.INVALID_HOLDED_KEY };
    }
    if (err.status >= 500) {
      return { code: "HOLDED_UNREACHABLE", message: MENSAJES.HOLDED_UNREACHABLE };
    }
    return {
      code: "HOLDED_UNEXPECTED_STATUS",
      message: MENSAJES.HOLDED_UNEXPECTED_STATUS,
    };
  }
  // Red, DNS, timeout, abort: aquí sí, Holded no responde.
  return { code: "HOLDED_UNREACHABLE", message: MENSAJES.HOLDED_UNREACHABLE };
}

// Holded devuelve `{ status: 0, info: "<motivo>" }` en los 4xx de v1.
// Devuelve el `info` normalizado, o null si el cuerpo no lo trae.
function infoDeHolded(body: unknown): string | null {
  if (body !== null && typeof body === "object" && "info" in body) {
    const info = (body as { info?: unknown }).info;
    if (typeof info === "string") return info.trim().toLowerCase();
  }
  return null;
}

// El alta y la rotación del super-admin devuelven estos fallos con SUS
// nombres de siempre (`HOLDED_API_KEY_INVALID`, 400) para no romper el
// front (`apps/admin/src/superadmin/error-messages.ts`). Lo que ya no
// decide cada ruta por su cuenta es QUÉ significa cada respuesta.
export function superAdminHoldedKeyFailure(err: unknown): {
  status: number;
  error: string;
  message: string;
} {
  const { code, message } = classifyHoldedKeyFailure(err);
  switch (code) {
    case "INVALID_HOLDED_KEY":
      return { status: 400, error: "HOLDED_API_KEY_INVALID", message };
    case "HOLDED_KEY_V1_REQUIRED":
      return { status: 400, error: "HOLDED_API_KEY_V1_REQUIRED", message };
    case "HOLDED_SUSPENDED":
      return { status: 400, error: "HOLDED_SUSPENDED", message };
    case "HOLDED_INVALID_RESPONSE":
      return { status: 502, error: "HOLDED_INVALID_RESPONSE", message };
    case "HOLDED_UNEXPECTED_STATUS":
      return { status: 502, error: "HOLDED_UNEXPECTED_STATUS", message };
    case "HOLDED_UNREACHABLE":
      return { status: 502, error: "HOLDED_UNREACHABLE", message };
  }
}

// El rechazo de un `pat_` antes de tocar la red, con la forma que esperan
// las rutas del super-admin. Mismo texto que el del probe.
export function superAdminRechazoPat(): {
  status: number;
  error: string;
  message: string;
} {
  return {
    status: 400,
    error: "HOLDED_API_KEY_V1_REQUIRED",
    message: MENSAJES.HOLDED_KEY_V1_REQUIRED,
  };
}
