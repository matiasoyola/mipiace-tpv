// v1.9.1 · Estado de conexión Holded del tenant para el super-admin.
//
// Caso real (Librería Thalia, diagnóstico 2026-07-03): su Holded llevaba
// suspendido (HTTP 402) un tiempo indeterminado y el super-admin seguía
// mostrando "Holded: Conectado" — el boolean `holdedApiKeyCiphertext !=
// null` sólo dice que hay una key guardada, no que funcione.
//
// Distinguimos los estados a partir del ÚLTIMO sync incremental, que ya
// persiste sus errores en `tenant.lastIncrementalSyncStats` (Json). No
// se hace ninguna llamada nueva a Holded: probar la key en el listado
// de tenants sería N requests por render.
//
//   NOT_CONNECTED — sin API key guardada (el "Sin conectar" de siempre).
//   SUSPENDED     — el último sync abortó con 402 (suscripción impagada;
//                   el sync está parado hasta que el cliente regularice).
//   ERROR         — el último sync abortó por otra causa.
//   CONNECTED     — hay key y el último sync no abortó (o aún no corrió).
//
// Sólo cuenta el error de nivel superior (`step: "<top>"`): los fallos
// de sub-pasos (contacts, image-backfill…) no abortan el sync y no
// deben degradar el badge.

export type HoldedConnectionStatus =
  | "NOT_CONNECTED"
  | "CONNECTED"
  | "SUSPENDED"
  | "ERROR";

export function holdedConnectionStatus(tenant: {
  holdedApiKeyCiphertext: string | null;
  lastIncrementalSyncStats: unknown;
}): HoldedConnectionStatus {
  if (tenant.holdedApiKeyCiphertext == null) return "NOT_CONNECTED";

  const stats = tenant.lastIncrementalSyncStats;
  if (stats == null || typeof stats !== "object") return "CONNECTED";
  const errors = (stats as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return "CONNECTED";

  const top = errors.find(
    (e): e is { message?: unknown; code?: unknown } =>
      e != null &&
      typeof e === "object" &&
      (e as { step?: unknown }).step === "<top>",
  );
  if (!top) return "CONNECTED";

  // `code` lo escribe incremental-sync desde v1.9.1. El match sobre el
  // mensaje cubre los stats persistidos ANTES de eso (Thalia en
  // producción): el texto viene fijo de HoldedSubscriptionSuspendedError.
  const message = typeof top.message === "string" ? top.message : "";
  if (top.code === "HOLDED_SUSPENDED" || /suspended \(HTTP 402\)/i.test(message)) {
    return "SUSPENDED";
  }
  return "ERROR";
}
