// Tests del estado de conexión Holded para super-admin (v1.9.1).
//
// El caso que motiva esto: Librería Thalia con el Holded suspendido por
// impago (HTTP 402) durante tiempo indeterminado mientras el super-admin
// mostraba "Conectado". El estado se deriva de lastIncrementalSyncStats
// (Json), sin llamadas nuevas a Holded.

import { describe, expect, it } from "vitest";

import { holdedConnectionStatus } from "../src/holded/connection-status.js";

function tenant(overrides: {
  key?: string | null;
  stats?: unknown;
}): { holdedApiKeyCiphertext: string | null; lastIncrementalSyncStats: unknown } {
  return {
    holdedApiKeyCiphertext: overrides.key === undefined ? "ciphertext" : overrides.key,
    lastIncrementalSyncStats: overrides.stats ?? null,
  };
}

describe("holdedConnectionStatus", () => {
  it("sin API key → NOT_CONNECTED", () => {
    expect(holdedConnectionStatus(tenant({ key: null }))).toBe("NOT_CONNECTED");
  });

  it("con key y sin stats (aún no corrió el incremental) → CONNECTED", () => {
    expect(holdedConnectionStatus(tenant({ stats: null }))).toBe("CONNECTED");
  });

  it("último sync limpio (errors vacío) → CONNECTED", () => {
    expect(holdedConnectionStatus(tenant({ stats: { errors: [] } }))).toBe(
      "CONNECTED",
    );
  });

  it("error de sub-paso (contacts) sin abortar el sync → CONNECTED", () => {
    const stats = {
      errors: [{ step: "contacts", message: "timeout iterando contactos" }],
    };
    expect(holdedConnectionStatus(tenant({ stats }))).toBe("CONNECTED");
  });

  it("sync abortado con code HOLDED_SUSPENDED (v1.9.1+) → SUSPENDED", () => {
    const stats = {
      errors: [
        {
          step: "<top>",
          message: "lo que sea",
          code: "HOLDED_SUSPENDED",
        },
      ],
    };
    expect(holdedConnectionStatus(tenant({ stats }))).toBe("SUSPENDED");
  });

  it("stats legacy (pre-v1.9.1, sin code) con el mensaje del 402 → SUSPENDED", () => {
    // Mensaje literal de HoldedSubscriptionSuspendedError tal y como
    // quedó persistido en producción (Thalia) antes de añadir `code`.
    const stats = {
      errors: [
        {
          step: "<top>",
          message:
            "Holded subscription is suspended (HTTP 402). Url=https://api.holded.com/api/invoicing/v1/taxes. " +
            "El propietario debe regularizar el pago en su cuenta Holded.",
        },
      ],
    };
    expect(holdedConnectionStatus(tenant({ stats }))).toBe("SUSPENDED");
  });

  it("sync abortado por otra causa → ERROR", () => {
    const stats = {
      errors: [{ step: "<top>", message: "Holded API 500 on /taxes" }],
    };
    expect(holdedConnectionStatus(tenant({ stats }))).toBe("ERROR");
  });

  it("stats con forma inesperada (sin errors array) → CONNECTED", () => {
    expect(holdedConnectionStatus(tenant({ stats: { foo: 1 } }))).toBe("CONNECTED");
    expect(holdedConnectionStatus(tenant({ stats: "corrupto" }))).toBe("CONNECTED");
    expect(holdedConnectionStatus(tenant({ stats: { errors: "no-array" } }))).toBe(
      "CONNECTED",
    );
  });
});
