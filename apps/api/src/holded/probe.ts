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
//
// holded-pat · QUÉ significa cada respuesta de Holded no se decide aquí:
// vive en `clave-rechazada.ts`, que es el único sitio que lo sabe y por
// el que pasan también el alta y la rotación del super-admin.

import { ApiKeyClient, listProductsPage } from "@mipiacetpv/holded-client";

import { loadEnv } from "../env.js";

import {
  classifyHoldedKeyFailure,
  esTokenPat,
  MENSAJES,
  type HoldedKeyFailureCode,
} from "./clave-rechazada.js";

export type ProbeFailureCode = HoldedKeyFailureCode;

export type ProbeResult =
  | { ok: true }
  | { ok: false; code: ProbeFailureCode; message: string };

export async function probeHoldedKey(apiKey: string): Promise<ProbeResult> {
  // Antes de la red: un `pat_` no entra en v1 con ninguna cabecera.
  if (esTokenPat(apiKey)) {
    return {
      ok: false,
      code: "HOLDED_KEY_V1_REQUIRED",
      message: MENSAJES.HOLDED_KEY_V1_REQUIRED,
    };
  }
  const env = loadEnv();
  const client = new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });
  try {
    await listProductsPage(client, 1);
    return { ok: true };
  } catch (err) {
    const { code, message } = classifyHoldedKeyFailure(err);
    return { ok: false, code, message };
  }
}

// Traducción canónica de código a HTTP status para el caller que no
// quiera decidirlo. INVALID y SUSPENDED mantienen los códigos de B1
// para no romper expectativas del front.
export function probeFailureToHttpStatus(code: ProbeFailureCode): number {
  switch (code) {
    case "INVALID_HOLDED_KEY":
      return 401;
    // Es un error de lo que se ha teclado, no de Holded: 400, y nunca
    // un 502 que invite a reintentar con la misma clave.
    case "HOLDED_KEY_V1_REQUIRED":
      return 400;
    case "HOLDED_SUSPENDED":
      return 402;
    case "HOLDED_INVALID_RESPONSE":
    case "HOLDED_UNEXPECTED_STATUS":
    case "HOLDED_UNREACHABLE":
      return 502;
  }
}
